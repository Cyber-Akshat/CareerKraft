(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.careerModuleFormatting = api;
  }
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";

  // Learning content is untrusted text. Only create the small set of elements
  // below; never interpret HTML, URLs, or Markdown links from a model response.
  function appendInline(parent, value, allowBold = true) {
    const document = parent.ownerDocument;
    const text = String(value);
    let position = 0;

    while (position < text.length) {
      const codeAt = text.indexOf("`", position);
      const boldAt = allowBold ? text.indexOf("**", position) : -1;
      const candidates = [codeAt, boldAt].filter(index => index >= 0);
      if (!candidates.length) {
        parent.append(document.createTextNode(text.slice(position)));
        break;
      }

      const start = Math.min(...candidates);
      parent.append(document.createTextNode(text.slice(position, start)));
      const isCode = start === codeAt;
      const marker = isCode ? text.slice(start).match(/^`+/)[0] : "**";
      const end = text.indexOf(marker, start + marker.length);
      if (end < 0) {
        parent.append(document.createTextNode(marker));
        position = start + marker.length;
        continue;
      }

      const node = document.createElement(isCode ? "code" : "strong");
      const content = text.slice(start + marker.length, end);
      if (isCode) node.textContent = content;
      else appendInline(node, content, false);
      parent.append(node);
      position = end + marker.length;
    }
  }

  // Mask quotations and inline code before looking for a compressed numbered
  // list. Numbers inside examples, URLs and quoted questions remain untouched.
  function maskProtectedText(text) {
    const masked = text.split("");
    let quote = null;
    let codeMarker = null;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (codeMarker) {
        if (text.startsWith(codeMarker, index)) {
          for (let offset = 0; offset < codeMarker.length; offset += 1) masked[index + offset] = " ";
          index += codeMarker.length - 1;
          codeMarker = null;
        } else masked[index] = " ";
        continue;
      }
      if (quote) {
        masked[index] = " ";
        if (character === quote && text[index - 1] !== "\\") quote = null;
        continue;
      }
      if (character === "`") {
        codeMarker = text.slice(index).match(/^`+/)[0];
        for (let offset = 0; offset < codeMarker.length; offset += 1) masked[index + offset] = " ";
        index += codeMarker.length - 1;
      } else if (character === '"' || character === "“" || character === "‘" || (character === "'" && !/[\p{L}\p{N}]/u.test(text[index - 1] || ""))) {
        quote = character === "“" ? "”" : character === "‘" ? "’" : character;
        masked[index] = " ";
      }
    }
    return masked.join("");
  }

  function expandNumberedLine(line) {
    const masked = maskProtectedText(line);
    const pattern = /(^|\s)(\d{1,2})[.)]\s+(?=\*\*\S|[A-Z])/g;
    const candidates = Array.from(masked.matchAll(pattern), match => ({
      number: Number(match[2]),
      index: match.index + match[1].length
    }));
    const start = candidates.findIndex(candidate => candidate.number === 1);
    if (start < 0) return [line];
    const sequence = [candidates[start]];
    for (const candidate of candidates.slice(start + 1)) {
      if (candidate.number !== sequence.length + 1) break;
      sequence.push(candidate);
    }
    // A single number in a sentence is not enough evidence of a list.
    if (sequence.length < 2) return [line];
    const parts = [];
    const prefix = line.slice(0, sequence[0].index).trimEnd();
    if (prefix.trim()) parts.push(prefix);
    sequence.forEach((candidate, index) => {
      const end = sequence[index + 1]?.index ?? line.length;
      parts.push(line.slice(candidate.index, end).trimEnd());
    });
    return parts;
  }

  function renderTextLines(container, lines) {
    const document = container.ownerDocument;
    const expanded = lines.flatMap(expandNumberedLine);
    let paragraph = [];
    let lists = [];
    let blank = true;

    function flushParagraph() {
      if (!paragraph.length) return;
      const node = document.createElement("p");
      paragraph.forEach((line, index) => {
        if (index) node.append(document.createElement("br"));
        appendInline(node, line);
      });
      container.append(node);
      paragraph = [];
    }

    for (const line of expanded) {
      if (!line.trim()) {
        flushParagraph();
        blank = true;
        continue;
      }
      const ordered = line.match(/^(\s*)(\d{1,3})[.)]\s+(\S.*)$/);
      const unordered = line.match(/^(\s*)[-+*•‣]\s+(\S.*)$/);
      const marker = ordered || unordered;

      if (marker) {
        flushParagraph();
        const type = ordered ? "ol" : "ul";
        const indent = marker[1].replace(/\t/g, "    ").length;
        while (lists.length && lists.at(-1).indent > indent) lists.pop();
        let current = lists.at(-1);
        if (current && current.indent === indent && current.type !== type) {
          // AI output often omits indentation for bullets below an instruction.
          // Keep those bullets inside the preceding numbered step.
          if (!(type === "ul" && current.type === "ol" && current.item)) {
            lists.pop();
            current = lists.at(-1);
          }
        }
        if (!current || current.type !== type || current.indent !== indent) {
          const list = document.createElement(type);
          if (ordered && Number(marker[2]) !== 1) list.start = Number(marker[2]);
          (current?.item || container).append(list);
          current = { type, indent, list, item: null, nextNumber: ordered ? Number(marker[2]) : null };
          lists.push(current);
        }
        const item = document.createElement("li");
        if (ordered) {
          const number = Number(marker[2]);
          if (number !== current.nextNumber) item.value = number;
          current.nextNumber = number + 1;
        }
        appendInline(item, ordered ? marker[3] : marker[2]);
        current.list.append(item);
        current.item = item;
        blank = false;
        continue;
      }

      if (lists.length && !blank) {
        const item = lists.at(-1).item;
        item.append(document.createElement("br"));
        appendInline(item, line.trim());
      } else {
        lists = [];
        paragraph.push(line.trim());
      }
      blank = false;
    }
    flushParagraph();
  }

  function renderLearningText(element, value) {
    if (!element) return;
    const document = element.ownerDocument;
    const fragment = document.createDocumentFragment();
    const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
    let normalLines = [];

    function flushNormal() {
      renderTextLines(fragment, normalLines);
      normalLines = [];
    }

    for (let index = 0; index < lines.length; index += 1) {
      const fence = lines[index].match(/^ {0,3}(`{3,}|~{3,})[^`~]*$/);
      if (!fence) {
        normalLines.push(lines[index]);
        continue;
      }
      flushNormal();
      const codeLines = [];
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      index += 1;
      for (; index < lines.length && !closing.test(lines[index]); index += 1) codeLines.push(lines[index]);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      fragment.append(pre);
    }
    flushNormal();
    element.classList.add("learning-rich-text");
    element.replaceChildren(fragment);
  }

  return { renderLearningText };
});
