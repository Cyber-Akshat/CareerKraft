const path = require('node:path');
const { SaxesParser } = require('saxes');
const ExcelJS = require('exceljs');

const MAX_XML_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_CELLS = 10000;
const MAX_SHEETS = 100;
const MAX_TEXT_LENGTH = 20000;
const MAX_SPREADSHEET_SHEETS = 5;
const MAX_SPREADSHEET_ROWS = 100;
const MAX_SPREADSHEET_COLUMNS = 30;
const MAIN_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main'
]);
const REL_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships'
]);

const attribute = (node, name) => node.attributes[name]?.value;
const spreadsheetNode = node => MAIN_NAMESPACES.has(node.uri);
const relationshipKind = type => String(type || '').split('/').pop();

// This reader only consumes strings already obtained by the bounded ZIP reader.
// Saxes has no external resource loader; declarations and excessive nesting are
// rejected as well, so workbook formulas and relationships remain inert data.
function parseXml(value, { open, text, close } = {}) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_XML_BYTES || /<!(?:DOCTYPE|ENTITY)\b/i.test(value)) {
    throw new Error('Unsupported workbook XML');
  }
  const stack = [];
  let nodes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', error => { throw error; });
  parser.on('doctype', () => { throw new Error('Unsupported XML declaration'); });
  parser.on('opentag', node => {
    if (++nodes > 250000 || stack.length >= 128) throw new Error('Workbook XML is too complex');
    stack.push(node);
    open?.(node, stack);
  });
  const onText = value => text?.(value, stack);
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', node => {
    close?.(node, stack);
    stack.pop();
  });
  parser.write(value).close();
}

function resolvePart(source, target) {
  if (!target || /[\\\u0000-\u001f?#%]/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const resolved = target.startsWith('/') ? path.posix.normalize(target.slice(1)) : path.posix.normalize(path.posix.join(path.posix.dirname(source), target));
  return !resolved || resolved === '.' || resolved === '..' || resolved.startsWith('../') ? null : resolved;
}

function readRelationships(xml, source, state) {
  const relationships = new Map();
  parseXml(xml, {
    open(node, stack) {
      if (stack.length === 1 && (node.local !== 'Relationships' || node.uri !== REL_NAMESPACE)) throw new Error('Invalid relationships');
      if (node.local !== 'Relationship' || node.uri !== REL_NAMESPACE) return;
      const id = attribute(node, 'Id');
      const type = attribute(node, 'Type');
      const target = attribute(node, 'Target');
      const mode = attribute(node, 'TargetMode');
      const external = mode === 'External';
      const part = external ? null : resolvePart(source, target);
      const inertHyperlink = state.allowHyperlinks && external && relationshipKind(type) === 'hyperlink';
      if (!id || !type || !target || relationships.has(id) || (external && !inertHyperlink) ||
          (mode && mode !== 'Internal' && !inertHyperlink) || (!part && !inertHyperlink)) state.complete = false;
      if (/^(?:externalLink|externalLinkPath|queryTable|connections|oleObject|package|control|vbaProject|drawing|chart|image|customXml)$/i.test(relationshipKind(type))) state.complete = false;
      relationships.set(id, { type, part, external });
    }
  });
  return relationships;
}

function externalFormula(value) {
  return /\[[^\]]+\][^!]*!|\|[^!]*!|\b(?:WEBSERVICE|RTD|SQL\.REQUEST|CALL|REGISTER(?:\.ID)?|EXEC|DDE|CUBE\w*|HYPERLINK|IMAGE)\s*\(|(?:https?|ftp|file):/i.test(value);
}

function readWorkbook(xml, state) {
  const sheets = [];
  const names = [];
  let definedName;
  let sheetCount = 0;
  parseXml(xml, {
    open(node, stack) {
      if (stack.length === 1 && (!spreadsheetNode(node) || node.local !== 'workbook')) throw new Error('Invalid workbook');
      if (!spreadsheetNode(node)) return;
      if (['externalReferences', 'pivotCaches', 'oleSize', 'extLst'].includes(node.local)) state.complete = false;
      if (node.local === 'sheet' && stack.at(-2)?.local === 'sheets') {
        const id = Object.values(node.attributes).find(item => item.local === 'id' && OFFICE_REL_NAMESPACES.has(item.uri))?.value;
        const name = attribute(node, 'name');
        const visibility = attribute(node, 'state');
        if (!id || !name || (visibility && visibility !== 'visible')) state.complete = false;
        if (++sheetCount <= MAX_SHEETS) sheets.push({ id, name: name || '(unnamed)' });
        else state.complete = false;
      }
      if (node.local === 'definedName') {
        definedName = { name: attribute(node, 'name'), text: '' };
        if (attribute(node, 'hidden') === '1' || attribute(node, 'hidden') === 'true') state.complete = false;
      }
    },
    text(value) { if (definedName) definedName.text += value; },
    close(node) {
      if (spreadsheetNode(node) && node.local === 'definedName' && definedName) {
        if (!definedName.name || externalFormula(definedName.text)) state.complete = false;
        names.push(definedName);
        definedName = undefined;
      }
    }
  });
  if (!sheets.length || new Set(sheets.map(sheet => sheet.id)).size !== sheets.length || new Set(sheets.map(sheet => sheet.name)).size !== sheets.length) state.complete = false;
  state.sheetCount = sheetCount;
  return { sheets, names };
}

function readSharedStrings(xml, state) {
  const strings = [];
  let current;
  let count = 0;
  parseXml(xml, {
    open(node, stack) {
      if (stack.length === 1 && (!spreadsheetNode(node) || node.local !== 'sst')) throw new Error('Invalid shared strings');
      if (spreadsheetNode(node) && node.local === 'si') {
        current = '';
        if (++count > MAX_CELLS) state.complete = false;
      }
    },
    text(value, stack) {
      if (current !== undefined && spreadsheetNode(stack.at(-1)) && stack.at(-1).local === 't' && !stack.some(node => node.local === 'rPh')) current += value;
    },
    close(node) {
      if (spreadsheetNode(node) && node.local === 'si') {
        if (count <= MAX_CELLS) strings.push(current);
        current = undefined;
      }
    }
  });
  return strings;
}

function cellCoordinate(address) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/i.exec(address || '');
  if (!match) return null;
  const column = [...match[1].toUpperCase()].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  return column <= 16384 && row <= 1048576 ? { column, row, address: `${match[1].toUpperCase()}${row}` } : null;
}

function columnName(column) {
  let name = '';
  while (column > 0) {
    column -= 1;
    name = String.fromCharCode(65 + column % 26) + name;
    column = Math.floor(column / 26);
  }
  return name;
}

function cellValue(cell, strings, state) {
  const value = cell.value.trim();
  switch (cell.type) {
    case 's': {
      const index = /^\d+$/.test(value) ? Number(value) : -1;
      if (!Number.isSafeInteger(index) || index < 0 || index >= strings.length) {
        state.complete = false;
        return '[shared string unavailable]';
      }
      return strings[index];
    }
    case 'inlineStr': return cell.inline;
    case 'str': return cell.value;
    case 'b':
      if (value === '1') return 'TRUE';
      if (value === '0') return 'FALSE';
      state.complete = false;
      return value;
    case 'e': return value ? `error ${value}` : '';
    case 'd': return value;
    case undefined:
    case 'n':
      if (value && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) state.complete = false;
      return value;
    default:
      state.complete = false;
      return cell.inline || cell.value;
  }
}

function readWorksheet(xml, strings, state) {
  const cells = [];
  const sharedFormulas = new Map();
  let current;
  let row = 0;
  let rowIsExplicit = false;
  let column = 0;
  parseXml(xml, {
    open(node, stack) {
      if (stack.length === 1 && (!spreadsheetNode(node) || node.local !== 'worksheet')) throw new Error('Unsupported worksheet');
      if (!spreadsheetNode(node)) return;
      if (['drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'pivotTableParts', 'conditionalFormatting', 'extLst'].includes(node.local)) state.complete = false;
      if (['row', 'col'].includes(node.local) && ['1', 'true'].includes(attribute(node, 'hidden'))) state.complete = false;
      if (node.local === 'row' && stack.at(-2)?.local === 'sheetData') {
        const value = attribute(node, 'r');
        rowIsExplicit = value !== undefined;
        row = value === undefined ? row + 1 : Number(value);
        if (!Number.isInteger(row) || row < 1 || row > 1048576) state.complete = false;
        column = 0;
      }
      if (node.local === 'c' && stack.at(-2)?.local === 'row') {
        const explicit = attribute(node, 'r');
        const coordinate = cellCoordinate(explicit === undefined ? `${columnName(column + 1)}${row}` : explicit);
        if (!coordinate) state.complete = false;
        else {
          if (rowIsExplicit && coordinate.row !== row) state.complete = false;
          if (!rowIsExplicit) row = coordinate.row;
          column = coordinate.column;
        }
        current = { coordinate, type: attribute(node, 't'), value: '', inline: '', hasValue: false, formula: undefined, include: ++state.cellCount <= MAX_CELLS };
        if (!current.include) state.complete = false;
      }
      if (!current) return;
      if (node.local === 'v') current.hasValue = true;
      if (node.local === 'f') current.formula = { text: '', type: attribute(node, 't'), index: attribute(node, 'si'), range: attribute(node, 'ref') };
    },
    text(value, stack) {
      if (!current || !spreadsheetNode(stack.at(-1))) return;
      const local = stack.at(-1).local;
      if (local === 'v') current.value += value;
      if (local === 'f' && current.formula) current.formula.text += value;
      if (local === 't' && stack.some(node => node.local === 'is') && !stack.some(node => node.local === 'rPh')) current.inline += value;
    },
    close(node) {
      if (!spreadsheetNode(node) || node.local !== 'c' || !current) return;
      if (current.include && current.coordinate) {
        if (current.formula?.type === 'shared' && current.formula.text) {
          if (current.formula.index === undefined || sharedFormulas.has(current.formula.index)) state.complete = false;
          sharedFormulas.set(current.formula.index, current);
        }
        cells.push(current);
      }
      current = undefined;
    }
  });
  cells.sort((left, right) => left.coordinate.row - right.coordinate.row || left.coordinate.column - right.coordinate.column);
  const addresses = new Set();
  return cells.flatMap(cell => {
    const address = cell.coordinate.address;
    if (addresses.has(address)) state.complete = false;
    addresses.add(address);
    let value = cellValue(cell, strings, state);
    if (cell.formula) {
      const formula = cell.formula;
      let expression = formula.text;
      if (formula.type === 'shared' && !expression) {
        const source = sharedFormulas.get(formula.index);
        if (source) expression = `shared from ${source.coordinate.address}: ${source.formula.text}`;
        else { expression = '[shared formula unavailable]'; state.complete = false; }
      }
      if (!expression || (formula.type && !['normal', 'shared', 'array'].includes(formula.type)) || externalFormula(expression)) state.complete = false;
      const range = formula.range && formula.type === 'array' ? ` (array range ${formula.range})` : '';
      value = `formula ${expression || '[unavailable]'}${range}${cell.hasValue ? `; cached ${value || '(empty)'}` : ''}`;
    }
    if (!value.trim()) return [];
    state.hasContent = true;
    return [`${address}: ${value.replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ')}`];
  });
}

function extractWorkbookText(archive, { maxTextLength = MAX_TEXT_LENGTH, includeDiagnostics = false, allowHyperlinks = false } = {}) {
  if (!(archive?.names instanceof Set) || !(archive?.xml instanceof Map)) throw new TypeError('Expected a safely read Office archive');
  if (!Number.isInteger(maxTextLength) || maxTextLength < 1) throw new RangeError('maxTextLength must be a positive integer');
  maxTextLength = Math.min(maxTextLength, MAX_TEXT_LENGTH);
  const state = { complete: true, cellCount: 0, hasContent: false, allowHyperlinks };
  const sections = [];
  try {
    if (archive.names.size > 1000) throw new Error('Too many archive entries');
    let xmlBytes = 0;
    for (const [name, xml] of archive.xml) {
      if (typeof name !== 'string' || typeof xml !== 'string' || !archive.names.has(name)) throw new Error('Invalid archive entry');
      const bytes = Buffer.byteLength(xml);
      xmlBytes += bytes;
      if (bytes > MAX_XML_BYTES || xmlBytes > MAX_ARCHIVE_BYTES || /<!(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('Unsupported workbook XML');
    }
    for (const name of archive.names) {
      if (typeof name !== 'string') throw new Error('Invalid archive entry');
      if (/^xl\/(?:media|charts|drawings|embeddings|externalLinks|queryTables|activeX|ctrlProps|tables|pivotTables|pivotCache|threadedComments|comments|macrosheets|dialogsheets|chartsheets)(?:\/|\d|\.)|^xl\/connections\.xml$|vbaProject\.bin$|^customXml\//i.test(name)) state.complete = false;
    }
    const relationshipParts = new Map();
    for (const [name, xml] of archive.xml) {
      if (!name.endsWith('.rels')) continue;
      const source = name === '_rels/.rels' ? '' : name.replace(/(^|\/)\_rels\//, '$1').replace(/\.rels$/, '');
      relationshipParts.set(name, readRelationships(xml, source, state));
    }
    const workbook = readWorkbook(archive.xml.get('xl/workbook.xml'), state);
    state.definedNames = workbook.names;
    const relationships = relationshipParts.get('xl/_rels/workbook.xml.rels');
    if (!relationships) throw new Error('Workbook relationships are missing');
    const sharedParts = [...relationships.values()].filter(item => relationshipKind(item.type) === 'sharedStrings');
    if (sharedParts.length > 1) state.complete = false;
    let sharedPart = sharedParts[0]?.part;
    if (!sharedPart && archive.xml.has('xl/sharedStrings.xml')) { sharedPart = 'xl/sharedStrings.xml'; state.complete = false; }
    const strings = sharedPart ? readSharedStrings(archive.xml.get(sharedPart), state) : [];
    const visited = new Set();
    for (const sheet of workbook.sheets) {
      const relationship = relationships.get(sheet.id);
      sections.push(`Worksheet: ${sheet.name.replace(/\r\n?|\n/g, ' ')}`);
      if (!relationship || relationship.external || relationshipKind(relationship.type) !== 'worksheet' || !relationship.part || visited.has(relationship.part)) {
        state.complete = false;
        continue;
      }
      visited.add(relationship.part);
      try {
        sections[sections.length - 1] += `\n${readWorksheet(archive.xml.get(relationship.part), strings, state).join('\n')}`;
      } catch { state.complete = false; }
    }
    for (const [name] of archive.xml) {
      if (/^xl\/worksheets\/.*\.xml$/i.test(name) && !visited.has(name)) state.complete = false;
    }
    for (const relationship of relationships.values()) {
      if (relationshipKind(relationship.type) === 'worksheet' && !visited.has(relationship.part)) state.complete = false;
    }
    for (const name of workbook.names) sections.push(`Defined name ${name.name || '(unnamed)'}: ${name.text}`);
  } catch { state.complete = false; }
  const text = sections.join('\n\n').replace(/\u0000/g, '').trim();
  return { textContent: text.slice(0, maxTextLength), reviewable: state.complete && state.hasContent && text.length <= maxTextLength,
    ...(includeDiagnostics ? { diagnostics: { complete: state.complete, sheetCount: state.sheetCount,
      textLength: text.length, definedNames: state.definedNames || [] } } : {}) };
}

function formatSpreadsheetCell(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return '';
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value !== 'object') return '';
  if (typeof value.formula === 'string' || typeof value.sharedFormula === 'string') {
    const expression = value.formula || `shared from ${value.sharedFormula}`;
    const result = value.result !== undefined ? ` → ${formatSpreadsheetCell(value.result, depth + 1)}` : '';
    return `FORMULA: ${expression}${result}`;
  }
  if (Array.isArray(value.richText)) return value.richText.map(part => typeof part?.text === 'string' ? part.text : '').join('');
  if (typeof value.text === 'string') return value.text;
  if (typeof value.error === 'string') return value.error;
  return '';
}

async function extractWorkbookWithExcelJS(buffer, archive, { maxTextLength = MAX_TEXT_LENGTH } = {}) {
  maxTextLength = Math.min(MAX_TEXT_LENGTH, maxTextLength);
  const metadata = { sheetCount: null, analysedSheets: 0, rowLimitPerSheet: MAX_SPREADSHEET_ROWS,
    columnLimitPerSheet: MAX_SPREADSHEET_COLUMNS, truncated: false };
  try {
    // Validate the bounded archive before ExcelJS materialises workbook objects.
    // Hidden, external, visual or structurally incomplete work stays manual.
    const preflight = extractWorkbookText(archive, { maxTextLength, includeDiagnostics: true, allowHyperlinks: true });
    metadata.sheetCount = preflight.diagnostics.sheetCount ?? null;
    if (!preflight.diagnostics.complete) {
      metadata.truncated = metadata.sheetCount > MAX_SPREADSHEET_SHEETS || preflight.diagnostics.textLength > maxTextLength;
      return { textContent: '', reviewable: false, metadata };
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    metadata.sheetCount = workbook.worksheets.length;
    const worksheets = workbook.worksheets.slice(0, MAX_SPREADSHEET_SHEETS);
    metadata.analysedSheets = worksheets.length;
    metadata.truncated = metadata.sheetCount > worksheets.length;
    const output = [];
    let hasContent = false;
    for (const worksheet of worksheets) {
      output.push(`WORKSHEET: ${worksheet.name}`);
      if (worksheet.rowCount > MAX_SPREADSHEET_ROWS || worksheet.columnCount > MAX_SPREADSHEET_COLUMNS) metadata.truncated = true;
      const maxRow = Math.min(worksheet.rowCount, MAX_SPREADSHEET_ROWS);
      for (let rowNumber = 1; rowNumber <= maxRow; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const values = [];
        const maxColumn = Math.min(Math.max(row.cellCount, 1), MAX_SPREADSHEET_COLUMNS);
        for (let columnNumber = 1; columnNumber <= maxColumn; columnNumber++) {
          const cell = row.getCell(columnNumber);
          // Resolving a shared formula translates its references; no formula is executed.
          // ExcelJS's public value getter omits falsy formula caches. Its model
          // retains the actual saved 0/false values, which must not be invented
          // or recalculated while formatting the student's workbook.
          const value = typeof cell.formula === 'string'
            ? { formula: cell.formula, result: cell.model.result !== undefined ? cell.model.result : cell.value?.result }
            : cell.value;
          values.push(formatSpreadsheetCell(value));
        }
        if (values.some(value => value.trim())) {
          hasContent = true;
          output.push(`ROW ${rowNumber}: ${values.join(' | ')}`);
        }
      }
      output.push('');
    }
    // ExcelJS may discard formula-valued defined names. Retain the names
    // already validated by preflight so named calculations are not omitted.
    for (const definedName of preflight.diagnostics.definedNames) {
      output.push(`DEFINED NAME: ${definedName.name}\nFORMULA: ${definedName.text}`, '');
    }
    const text = output.join('\n').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    if (text.length > maxTextLength) metadata.truncated = true;
    return { textContent: text.slice(0, maxTextLength), reviewable: hasContent && text.length >= 10 && !metadata.truncated, metadata };
  } catch {
    return { textContent: '', reviewable: false, metadata };
  }
}

module.exports = { extractWorkbookText, formatSpreadsheetCell, extractWorkbookWithExcelJS,
  MAX_SPREADSHEET_SHEETS, MAX_SPREADSHEET_ROWS, MAX_SPREADSHEET_COLUMNS };
