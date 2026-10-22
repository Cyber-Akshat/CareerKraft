const path = require('node:path');
const { open } = require('node:fs/promises');
const { TextDecoder } = require('node:util');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');
const { ALLOWED_EVIDENCE_EXTENSIONS, SUPPORTED_EVIDENCE_ACCEPT, isAllowedEvidenceFilename } = require('./evidence-policy');
const { extractWorkbookWithExcelJS } = require('./workbook-evidence');

const MAX_EVIDENCE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_EVIDENCE_TEXT_LENGTH = 20000;
const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_EXPANDED_ARCHIVE_SIZE = 25 * 1024 * 1024;
const MAX_XML_SIZE = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const MAX_PRESENTATION_SLIDES = 40;

const FILE_TYPES = {
  '.txt': { mime: 'text/plain' },
  '.md': { mime: 'text/markdown' },
  '.csv': { mime: 'text/csv' },
  '.pdf': { mime: 'application/pdf' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.doc': { mime: 'application/msword' },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.png': { mime: 'image/png' },
  '.jpg': { mime: 'image/jpeg' },
  '.jpeg': { mime: 'image/jpeg' },
  '.webp': { mime: 'image/webp' }
};

const CODE_EXTENSIONS = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.kts', '.dart', '.sh', '.sql']);
const TEXT_EVIDENCE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', ...CODE_EXTENSIONS]);
const MANUAL_MIME_TYPES = {
  '.rtf': 'application/rtf', '.xls': 'application/vnd.ms-excel', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm'
};
for (const extension of TEXT_EVIDENCE_EXTENSIONS) {
  if (!FILE_TYPES[extension]) FILE_TYPES[extension] = { mime: extension === '.json' ? 'application/json' : extension === '.xml' ? 'application/xml' : 'text/plain' };
}
for (const [extension, mime] of Object.entries(MANUAL_MIME_TYPES)) FILE_TYPES[extension] = { mime };
FILE_TYPES['.ipynb'] = { mime: 'application/x-ipynb+json' };
FILE_TYPES['.xlsx'] = { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function evidenceTypeForExtension(extension) {
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  if (TEXT_EVIDENCE_EXTENSIONS.has(extension)) return 'text';
  if (extension === '.ipynb') return 'notebook';
  if (['.xlsx', '.xls', '.ods'].includes(extension)) return 'spreadsheet';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)) return 'image';
  if (['.mp3', '.wav', '.m4a', '.ogg'].includes(extension)) return 'audio';
  if (['.mp4', '.mov', '.webm'].includes(extension)) return 'video';
  return { '.pdf': 'pdf', '.docx': 'docx', '.doc': 'doc', '.rtf': 'document', '.pptx': 'pptx', '.ppt': 'presentation', '.odp': 'presentation' }[extension] || 'unsupported';
}

function fileError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}

function safeFileName(value) {
  const basename = path.posix.basename(path.win32.basename(String(value || '')))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  const extension = path.extname(basename);
  return path.basename(basename, extension).slice(0, Math.max(0, 180 - extension.length)) + extension;
}

function decodeText(buffer, trim = true) {
  let encoding = 'utf-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le';
  if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Binary content');
    const normalized = text.replace(/\r\n?/g, '\n');
    return trim ? normalized.trim() : normalized;
  } catch {
    throw fileError('This text file could not be read. Please upload a UTF-8 or UTF-16 text file.');
  }
}

function normalizeExtractedEvidenceText(value) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim() : '';
}

function cleanExtractedEvidenceText(value) {
  return normalizeExtractedEvidenceText(value).slice(0, MAX_EVIDENCE_TEXT_LENGTH);
}

function boundedText(value, sourceCode = false) {
  const text = sourceCode && typeof value === 'string' ? value : normalizeExtractedEvidenceText(value);
  return { textContent: text.slice(0, MAX_EVIDENCE_TEXT_LENGTH), reviewable: text.trim().length > 0 && text.length <= MAX_EVIDENCE_TEXT_LENGTH };
}

// Bound the actual expanded bytes rather than trusting the ZIP directory.
async function readOfficeArchive(buffer) {
  const zip = await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => {
      if (error) reject(fileError('This document is damaged or is not a supported Office file.'));
      else resolve(archive);
    });
  });
  return new Promise((resolve, reject) => {
    const names = new Set();
    const xml = new Map();
    let count = 0;
    let expanded = 0;
    let finished = false;
    const fail = error => {
      if (finished) return;
      finished = true;
      zip.close();
      reject(error.status ? error : fileError('This document is damaged or could not be read.'));
    };
    zip.on('error', fail);
    zip.on('entry', entry => {
      if (finished) return;
      count += 1;
      if (count > MAX_ARCHIVE_ENTRIES || entry.uncompressedSize > MAX_EXPANDED_ARCHIVE_SIZE || expanded + entry.uncompressedSize > MAX_EXPANDED_ARCHIVE_SIZE) {
        fail(fileError('This document contains too much expanded data. Please upload a smaller document.', 413));
        return;
      }
      if (names.has(entry.fileName) || (entry.generalPurposeBitFlag & 1) !== 0) {
        fail(fileError('This document contains duplicate or encrypted entries. Please upload an unencrypted document.'));
        return;
      }
      names.add(entry.fileName);
      if (entry.fileName.endsWith('/')) {
        zip.readEntry();
        return;
      }
      const isXml = /\.(?:xml|rels)$/i.test(entry.fileName);
      if (isXml && entry.uncompressedSize > MAX_XML_SIZE) {
        fail(fileError('This document is too complex to process. Please upload a smaller document.', 413));
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        const chunks = [];
        let entrySize = 0;
        stream.on('error', fail);
        stream.on('data', chunk => {
          entrySize += chunk.length;
          expanded += chunk.length;
          if (expanded > MAX_EXPANDED_ARCHIVE_SIZE || (isXml && entrySize > MAX_XML_SIZE)) {
            stream.destroy();
            fail(fileError('This document contains too much expanded data. Please upload a smaller document.', 413));
            return;
          }
          if (isXml) chunks.push(chunk);
        });
        stream.on('end', () => {
          if (finished) return;
          if (isXml) {
            try {
              const value = decodeText(Buffer.concat(chunks));
              if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw fileError('This document contains unsupported XML declarations.');
              xml.set(entry.fileName, value);
            } catch (error) {
              fail(error);
              return;
            }
          }
          zip.readEntry();
        });
      });
    });
    zip.on('end', () => {
      if (finished) return;
      finished = true;
      resolve({ names, xml });
    });
    zip.readEntry();
  });
}

function extractXmlText(xml, format) {
  const namespace = format === 'word'
    ? /^(?:http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/wordprocessingml\/main)$/
    : /^(?:http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/drawingml\/main)$/;
  const parts = [];
  let inText = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', error => { throw error; });
  parser.on('doctype', () => { throw fileError('This document contains unsupported XML declarations.'); });
  parser.on('opentag', node => {
    if (!namespace.test(node.uri)) return;
    if (node.local === 't') inText = true;
    if (node.local === 'tab') parts.push('\t');
    if (node.local === 'br') parts.push('\n');
  });
  parser.on('text', value => { if (inText) parts.push(value); });
  parser.on('cdata', value => { if (inText) parts.push(value); });
  parser.on('closetag', node => {
    if (!namespace.test(node.uri)) return;
    if (node.local === 't') inText = false;
    if (node.local === 'p') parts.push('\n');
  });
  parser.write(xml).close();
  return parts.join('').trim();
}

function presentationSlideOrder(archive) {
  const relationships = archive.xml.get('ppt/_rels/presentation.xml.rels');
  if (!relationships) return null;
  const targets = new Map();
  const ids = [];
  const relationshipParser = new SaxesParser({ xmlns: true });
  relationshipParser.on('error', error => { throw error; });
  relationshipParser.on('opentag', node => {
    if (node.local !== 'Relationship' || node.attributes.TargetMode?.value === 'External') return;
    const target = node.attributes.Target?.value;
    const id = node.attributes.Id?.value;
    if (!target || !id || target.includes('\\')) return;
    const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`ppt/${target}`);
    if (/^ppt\/slides\/slide\d+\.xml$/.test(resolved)) targets.set(id, resolved);
  });
  relationshipParser.write(relationships).close();
  const presentationParser = new SaxesParser({ xmlns: true });
  presentationParser.on('error', error => { throw error; });
  presentationParser.on('opentag', node => {
    if (node.local !== 'sldId') return;
    const id = Object.values(node.attributes).find(attribute => attribute.local === 'id' && /relationships$/.test(attribute.uri))?.value;
    ids.push(targets.get(id));
  });
  presentationParser.write(archive.xml.get('ppt/presentation.xml')).close();
  if (!ids.length || ids.some(name => !name || !archive.xml.has(name)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

async function extractOfficeText(buffer, extension) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw fileError('This file is not a valid Office document.');
  const archive = await readOfficeArchive(buffer);
  const mainPart = extension === '.docx' ? 'word/document.xml' : 'ppt/presentation.xml';
  if (!archive.xml.has('[Content_Types].xml') || !archive.xml.has(mainPart)) throw fileError('This file is not a valid supported Office document.');
  if ([...archive.names].some(name => /vbaProject\.bin$/i.test(name))) throw fileError('Please upload a document without macros.');
  const hasVisualContent = [...archive.names].some(name => /^(?:word|ppt)\/(?:media|charts|embeddings|afchunk)\//i.test(name));
  if (extension === '.docx') {
    try {
      const parts = [archive.xml.get(mainPart)];
      for (const [name, xml] of archive.xml) {
        if (/^word\/(?:header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(name)) parts.push(xml);
      }
      const extracted = boundedText(parts.map(xml => extractXmlText(xml, 'word')).join('\n\n'));
      const containsObjects = parts.some(xml => /<(?:\w+:)?(?:drawing|object|pict)\b/.test(xml));
      return { ...extracted, reviewable: extracted.reviewable && !hasVisualContent && !containsObjects };
    } catch {
      return { textContent: '', reviewable: false };
    }
  }
  let slides = [...archive.xml.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(([left], [right]) => Number(left.match(/slide(\d+)\.xml$/)[1]) - Number(right.match(/slide(\d+)\.xml$/)[1]));
  if (!slides.length) throw fileError('This presentation does not contain any readable slides.');
  let missingText = false;
  const metadata = { slideCount: slides.length, analysedSlides: 0, visualContentAnalysed: false, truncated: false };
  try {
    const order = presentationSlideOrder(archive);
    if (order) {
      if (order.length !== slides.length) missingText = true;
      slides = order.map(name => [name, archive.xml.get(name)]);
    }
    else missingText = true;
    metadata.truncated = slides.length > MAX_PRESENTATION_SLIDES;
    const selectedSlides = slides.slice(0, MAX_PRESENTATION_SLIDES);
    metadata.analysedSlides = selectedSlides.length;
    let sourceCharacters = 0;
    const text = selectedSlides.map(([, xml], index) => {
      const value = extractXmlText(xml, 'presentation');
      if (!value) missingText = true;
      sourceCharacters += value.length;
      return `Slide ${index + 1}\n${value}`;
    }).join('\n\n');
    const notes = [...archive.xml.entries()]
      .filter(([name]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
      .map(([, xml]) => extractXmlText(xml, 'presentation'))
      .filter(Boolean);
    const combined = [text, ...notes].join('\n\n');
    const extracted = boundedText(combined);
    metadata.truncated ||= normalizeExtractedEvidenceText(combined).length > MAX_EVIDENCE_TEXT_LENGTH;
    metadata.containsVisualContent = hasVisualContent || selectedSlides.some(([, xml]) => /<(?:\w+:)?(?:pic|graphicFrame|oleObj)\b/.test(xml));
    return { ...extracted, metadata, reviewable: extracted.reviewable && sourceCharacters >= 20 &&
      !metadata.containsVisualContent && !missingText && !metadata.truncated };
  } catch {
    return { textContent: '', reviewable: false, metadata: { ...metadata, processingFailed: true } };
  }
}

function extractNotebookText(buffer) {
  try {
    const notebook = JSON.parse(decodeText(buffer));
    if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells) || !notebook.cells.length || notebook.cells.length > 1000) {
      return { textContent: '', reviewable: false };
    }
    const parts = [];
    let complete = true;
    let sourceCharacters = 0;
    for (const [index, cell] of notebook.cells.entries()) {
      if (!cell || !['code', 'markdown', 'raw'].includes(cell.cell_type)) { complete = false; continue; }
      const source = typeof cell.source === 'string' ? cell.source
        : Array.isArray(cell.source) && cell.source.every(value => typeof value === 'string') ? cell.source.join('') : null;
      if (source === null) { complete = false; continue; }
      sourceCharacters += source.trim().length;
      parts.push(`Cell ${index + 1} (${cell.cell_type})\n${source}`);
      if (cell.attachments && Object.keys(cell.attachments).length) complete = false;
      if (Array.isArray(cell.outputs) && cell.outputs.some(output => output?.data &&
        Object.keys(output.data).some(mime => mime !== 'text/plain'))) complete = false;
    }
    const result = boundedText(parts.join('\n\n'), true);
    return { ...result, reviewable: result.reviewable && complete && sourceCharacters >= 10, cellCount: notebook.cells.length };
  } catch {
    return { textContent: '', reviewable: false, cellCount: 0 };
  }
}

async function extractSpreadsheetText(buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw fileError('This file is not a valid Excel workbook.');
  const archive = await readOfficeArchive(buffer);
  if (!archive.xml.has('[Content_Types].xml') || !archive.xml.has('xl/workbook.xml')) throw fileError('This file is not a valid Excel workbook.');
  if ([...archive.names].some(name => /vbaProject\.bin$/i.test(name))) throw fileError('Please upload a workbook without macros.');
  return extractWorkbookWithExcelJS(buffer, archive, { maxTextLength: MAX_EVIDENCE_TEXT_LENGTH });
}

async function extractPdfText(buffer) {
  if (!/^%PDF-\d\.\d/.test(buffer.subarray(0, 16).toString('ascii')) || !buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'))) {
    throw fileError('This file is not a valid PDF document.');
  }
  let parser;
  try {
    const { PDFParse } = require('pdf-parse');
    // Pass a fresh Uint8Array because PDF.js may transfer its input buffer.
    parser = new PDFParse({ data: Uint8Array.from(buffer), isEvalSupported: false });
    const result = await parser.getText({ first: MAX_PDF_PAGES, pageJoiner: '' });
    const extracted = boundedText(result.text);
    const containsImages = /\/Subtype\s*\/Image\b/.test(buffer.toString('latin1'));
    const complete = !containsImages && result.total <= MAX_PDF_PAGES && result.pages.length === result.total && result.pages.every(page => page.text.trim().length > 0);
    return { ...extracted, reviewable: extracted.reviewable && complete };
  } catch (error) {
    if (error.name === 'InvalidPDFException' || error.name === 'FormatError') throw fileError('This PDF is damaged or could not be read. Please upload a valid PDF.');
    // Valid-looking encrypted/scanned PDFs are still submissions. They remain
    // available to a reviewer rather than forcing the student to rewrite them.
    return { textContent: '', reviewable: false };
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

function validateImage(buffer, extension) {
  const valid = extension === '.png'
    ? buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.subarray(12, 16).toString('ascii') === 'IHDR' && buffer.includes(Buffer.from('IEND'))
    : extension === '.webp'
      ? buffer.length >= 20 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' && buffer.readUInt32LE(4) + 8 === buffer.length
      : buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (!valid) throw fileError('This file is not a valid supported image.');
}

async function inspectEvidenceFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw fileError('Please upload a non-empty file.');
  if (file.buffer.length > MAX_EVIDENCE_FILE_SIZE || Number(file.size) > MAX_EVIDENCE_FILE_SIZE) throw fileError('Files must be 10 MB or smaller.', 413);
  if (!isAllowedEvidenceFilename(file.originalname)) throw fileError('This file type is not supported by CareerKraft.');
  const fileName = safeFileName(file.originalname);
  const extension = path.extname(fileName).toLowerCase();
  const type = FILE_TYPES[extension];
  if (!type) throw fileError('This file type is not supported by CareerKraft.');
  let extracted;
  if (extension === '.ipynb') {
    extracted = extractNotebookText(file.buffer);
  } else if (TEXT_EVIDENCE_EXTENSIONS.has(extension)) {
    try {
      const text = decodeText(file.buffer, !CODE_EXTENSIONS.has(extension));
      extracted = text.trim() ? boundedText(text, CODE_EXTENSIONS.has(extension))
        : { textContent: '', reviewable: false };
      extracted.reviewable = extracted.reviewable && text.trim().length >= 10;
    } catch {
      extracted = { textContent: '', reviewable: false };
    }
  } else if (extension === '.xlsx') {
    extracted = await extractSpreadsheetText(file.buffer);
  } else if (extension === '.pdf') {
    extracted = await extractPdfText(file.buffer);
    extracted.reviewable = extracted.reviewable && extracted.textContent.length >= 40;
  } else if (extension === '.doc') {
    // Legacy binary Word work is accepted for a person to inspect, never assessed from its filename.
    const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (file.buffer.length < 512 || !file.buffer.subarray(0, 8).equals(oleSignature)) {
      throw fileError('This file is not a valid legacy Word document.');
    }
    extracted = { textContent: '', reviewable: false };
  } else if (extension === '.docx' || extension === '.pptx') {
    extracted = await extractOfficeText(file.buffer, extension);
    if (extension === '.docx') extracted.reviewable = extracted.reviewable && extracted.textContent.length >= 20;
  } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    validateImage(file.buffer, extension);
    extracted = { textContent: '', reviewable: false };
  } else {
    // Media, visual formats and legacy documents are stored as private
    // attachments. Their contents are never rendered, evaluated or executed.
    extracted = { textContent: '', reviewable: false };
  }
  const metadata = TEXT_EVIDENCE_EXTENSIONS.has(extension) || extension === '.ipynb' ? {
    extension, originalName: fileName,
    ...(extension === '.ipynb' ? { cellCount: Number.isInteger(extracted.cellCount) ? extracted.cellCount : 0 } : {})
  } : extracted.metadata || null;
  return { fileName, mimeType: type.mime, fileType: evidenceTypeForExtension(extension), buffer: file.buffer,
    ...extracted, ...(metadata ? { metadata } : {}) };
}

/* =========================================
   EXTRACT STUDENT EVIDENCE
========================================= */
async function extractUploadedEvidence(uploadedFile, { processMediaEvidence } = {}) {
  if (!uploadedFile) return { type: 'none', text: '', autoReviewable: false };
  const mimeType = uploadedFile.mimeType || uploadedFile.mimetype;
  const extension = path.extname(uploadedFile.originalname || uploadedFile.fileName || uploadedFile.path || '').toLowerCase();
  const type = uploadedFile.fileType || (ALLOWED_EVIDENCE_EXTENSIONS.has(extension) ? evidenceTypeForExtension(extension) :
    ['text/plain', 'text/markdown', 'text/x-markdown', 'text/csv', 'application/csv'].includes(mimeType) ? 'text'
    : mimeType === 'application/pdf' ? 'pdf'
    : mimeType === FILE_TYPES['.docx'].mime ? 'docx'
    : mimeType === FILE_TYPES['.pptx'].mime ? 'pptx'
    : mimeType === 'application/msword' ? 'doc'
    : ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'].includes(mimeType) ? 'image' : 'unsupported');
  if (['image', 'audio', 'video'].includes(type)) {
    const supported = ['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.m4a', '.ogg', '.mp4', '.mov', '.webm'].includes(extension);
    if (!supported || typeof processMediaEvidence !== 'function') return { type, text: '', autoReviewable: false };
    try {
      const result = await processMediaEvidence(uploadedFile);
      const metadata = result?.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata) ? result.metadata : {};
      const resultType = type === 'video' && extension === '.webm' && result?.type === 'audio' ? 'audio' : type;
      const text = normalizeExtractedEvidenceText(result?.text);
      const proof = resultType === 'image' ? metadata.visionAnalysed === true
        : resultType === 'audio' ? metadata.transcription === true
        : metadata.visualAnalysisAvailable === true && Number.isInteger(metadata.sampledFrames) &&
          metadata.sampledFrames > 0 && metadata.sampledFrames <= 3 &&
          (metadata.audioPresent === false || metadata.transcriptAvailable === true);
      return { type: resultType, text: text.slice(0, MAX_EVIDENCE_TEXT_LENGTH), metadata,
        autoReviewable: result?.type === resultType && result.autoReviewable === true && proof &&
          metadata.processingFailed !== true && metadata.truncated !== true &&
          text.length >= (resultType === 'audio' ? 10 : 20) && text.length <= MAX_EVIDENCE_TEXT_LENGTH };
    } catch {
      return { type, text: '', autoReviewable: false, metadata: { processingFailed: true } };
    }
  }
  if (['doc', 'document', 'presentation', 'unsupported'].includes(type) || ['.xls', '.ods'].includes(extension)) {
    return { type, text: '', autoReviewable: false };
  }
  try {
    // Reuse the inspected upload in the submission route; disk-backed callers
    // can use the same extraction contract without parsing a document twice.
    let inspected = uploadedFile;
    if (typeof inspected.reviewable !== 'boolean' || typeof inspected.textContent !== 'string') {
      let buffer = uploadedFile.buffer;
      if (!Buffer.isBuffer(buffer)) {
        const handle = await open(uploadedFile.path, 'r');
        try {
          const stats = await handle.stat();
          if (!stats.isFile() || stats.size > MAX_EVIDENCE_FILE_SIZE) throw fileError('This file cannot be processed.');
          buffer = await handle.readFile();
        } finally { await handle.close(); }
      }
      inspected = await inspectEvidenceFile({ buffer, mimetype: mimeType,
        originalname: uploadedFile.originalname || uploadedFile.fileName || path.basename(uploadedFile.path || '') });
    }
    const preserveSource = type === 'code' || type === 'notebook';
    const text = preserveSource ? inspected.textContent.slice(0, MAX_EVIDENCE_TEXT_LENGTH) : cleanExtractedEvidenceText(inspected.textContent);
    const minimumLength = type === 'pdf' ? 40 : type === 'docx' ? 20 : ['text', 'code', 'notebook'].includes(type) ? 10 : 1;
    const originalLength = preserveSource ? inspected.textContent.length : normalizeExtractedEvidenceText(inspected.textContent).length;
    return { type, text, autoReviewable: inspected.reviewable && text.trim().length >= minimumLength && originalLength <= MAX_EVIDENCE_TEXT_LENGTH,
      ...(inspected.metadata ? { metadata: inspected.metadata } : {}) };
  } catch {
    return { type: 'extraction_failed', text: '', autoReviewable: false };
  }
}

module.exports = { MAX_EVIDENCE_FILE_SIZE, MAX_EVIDENCE_TEXT_LENGTH, TEXT_EVIDENCE_EXTENSIONS, SUPPORTED_EVIDENCE_ACCEPT,
  cleanExtractedEvidenceText, extractUploadedEvidence, inspectEvidenceFile };
