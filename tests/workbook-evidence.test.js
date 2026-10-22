const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractWorkbookText } = require('../workbook-evidence');

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const worksheet = content => `<worksheet xmlns="${MAIN}"><sheetData>${content}</sheetData></worksheet>`;
const row = (number, cells, attributes = '') => `<row r="${number}" ${attributes}>${cells}</row>`;
const cell = (address, value, type = '') => `<c r="${address}"${type ? ` t="${type}"` : ''}><v>${value}</v></c>`;
const inline = (address, text) => `<c r="${address}" t="inlineStr"><is><t>${text}</t></is></c>`;
const formula = (address, expression, cached = undefined, attributes = '', type = '') => `<c r="${address}"${type ? ` t="${type}"` : ''}><f ${attributes}>${expression}</f>${cached === undefined ? '' : `<v>${cached}</v>`}</c>`;
const relationship = (id, kind, target, attributes = '') => `<Relationship Id="${id}" Type="${OFFICE_REL}/${kind}" Target="${target}" ${attributes}/>`;
const rels = content => `<Relationships xmlns="${PACKAGE_REL}">${content}</Relationships>`;

function archive(sheets = [{ name: 'January', text: worksheet(row(1, inline('A1', 'Product'))) }], extras = []) {
  const entries = [
    ['[Content_Types].xml', '<Types/>'],
    ['xl/workbook.xml', `<workbook xmlns="${MAIN}" xmlns:r="${OFFICE_REL}"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}" ${sheet.attributes || ''}/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', rels(sheets.map((sheet, index) => relationship(`rId${index + 1}`, sheet.kind || 'worksheet', sheet.target || `worksheets/sheet${index + 1}.xml`)).join(''))],
    ...sheets.map((sheet, index) => [sheet.path || `xl/worksheets/sheet${index + 1}.xml`, sheet.text]),
    ...extras
  ];
  return { names: new Set(entries.map(([name]) => name)), xml: new Map(entries) };
}

function replacePart(value, name, text) {
  value.names.add(name);
  value.xml.set(name, text);
  return value;
}

test('workbook extraction preserves worksheet names, workbook order, and cell coordinates', () => {
  const value = archive([
    { name: 'February', text: worksheet(row(3, cell('B3', '2')) + row(1, inline('C1', 'Later column') + inline('A1', 'First column'))), target: '/xl/worksheets/sheet2.xml', path: 'xl/worksheets/sheet2.xml' },
    { name: 'January &amp; notes', text: worksheet(row(2, cell('A2', '12.5'))), target: 'worksheets/sheet1.xml', path: 'xl/worksheets/sheet1.xml' }
  ]);
  assert.deepEqual(extractWorkbookText(value), {
    textContent: 'Worksheet: February\nA1: First column\nC1: Later column\nB3: 2\n\nWorksheet: January & notes\nA2: 12.5',
    reviewable: true
  });
});

test('rich shared and inline strings, booleans, numbers, dates, and error cells are readable', () => {
  const value = archive([{ name: 'Data', text: worksheet(row(1,
    cell('A1', '0', 's') + '<c r="B1" t="inlineStr"><is><r><t>With </t></r><r><t>detail &amp; context</t></r><rPh sb="0" eb="2"><t>phonetic</t></rPh></is></c>' +
    cell('C1', '1', 'b') + cell('D1', '0', 'b') + cell('E1', '-1.25E+2') + cell('F1', '#DIV/0!', 'e') + cell('G1', '2026-01-12', 'd') + cell('H1', 'String result', 'str'))) }], [
    ['xl/strings/items.xml', `<sst xmlns="${MAIN}"><si><r><t xml:space="preserve">Gross </t></r><r><t>profit</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si></sst>`]
  ]);
  value.xml.set('xl/_rels/workbook.xml.rels', value.xml.get('xl/_rels/workbook.xml.rels').replace('</Relationships>', `${relationship('strings', 'sharedStrings', 'strings/items.xml')}</Relationships>`));
  const result = extractWorkbookText(value);
  assert.equal(result.reviewable, true);
  assert.equal(result.textContent, 'Worksheet: Data\nA1: Gross profit\nB1: With detail & context\nC1: TRUE\nD1: FALSE\nE1: -1.25E+2\nF1: error #DIV/0!\nG1: 2026-01-12\nH1: String result');
});

test('formula expressions and cached results are preserved without executing the expressions', () => {
  const value = archive([{ name: 'Budget', text: worksheet(row(2,
    cell('B2', '3') + cell('C2', '4') + formula('D2', 'B2*C2', '12') +
    formula('E2', 'IF(D2&gt;10,&quot;yes&quot;,&quot;no&quot;)', 'yes', '', 'str') + formula('F2', 'SUM(B2:D2)') + formula('G2', '1/0', '#DIV/0!', '', 'e'))) }]);
  const result = extractWorkbookText(value);
  assert.equal(result.reviewable, true);
  assert.match(result.textContent, /D2: formula B2\*C2; cached 12/);
  assert.match(result.textContent, /E2: formula IF\(D2>10,"yes","no"\); cached yes/);
  assert.match(result.textContent, /F2: formula SUM\(B2:D2\)/);
  assert.doesNotMatch(result.textContent, /F2:.*cached/);
  assert.match(result.textContent, /G2: formula 1\/0; cached error #DIV\/0!/);
});

test('shared and array formulas retain their source and cached values', () => {
  const value = archive([{ name: 'Calculations', text: worksheet(
    row(2, formula('C2', '', '8', 't="shared" si="0"')) +
    row(1, formula('C1', 'A1*B1', '6', 't="shared" si="0" ref="C1:C2"') + formula('D1', 'SUM(A1:A2*B1:B2)', '14', 't="array" ref="D1:D2"'))
  ) }]);
  const result = extractWorkbookText(value);
  assert.equal(result.reviewable, true);
  assert.match(result.textContent, /C1: formula A1\*B1; cached 6/);
  assert.match(result.textContent, /C2: formula shared from C1: A1\*B1; cached 8/);
  assert.match(result.textContent, /D1: formula SUM\(A1:A2\*B1:B2\) \(array range D1:D2\); cached 14/);
});

test('omitted cell addresses can be inferred from worksheet rows', () => {
  const value = archive([{ name: 'Data', text: worksheet('<row><c t="inlineStr"><is><t>Label</t></is></c><c><v>4</v></c></row><row><c><v>5</v></c></row>') }]);
  assert.deepEqual(extractWorkbookText(value), { textContent: 'Worksheet: Data\nA1: Label\nB1: 4\nA2: 5', reviewable: true });
});

test('strict OOXML namespaces are supported', () => {
  const value = archive();
  for (const [name, xml] of value.xml) value.xml.set(name, xml.replaceAll(MAIN, 'http://purl.oclc.org/ooxml/spreadsheetml/main').replaceAll(OFFICE_REL, 'http://purl.oclc.org/ooxml/officeDocument/relationships'));
  assert.equal(extractWorkbookText(value).reviewable, true);
});

test('hidden worksheets, rows, and columns preserve readable work for manual review', () => {
  const fixtures = [
    archive([{ name: 'Hidden', attributes: 'state="veryHidden"', text: worksheet(row(1, inline('A1', 'Hidden work'))) }]),
    archive([{ name: 'Hidden row', text: worksheet(row(1, inline('A1', 'Hidden work'), 'hidden="1"')) }]),
    archive([{ name: 'Hidden column', text: `<worksheet xmlns="${MAIN}"><cols><col min="1" max="1" hidden="true"/></cols><sheetData>${row(1, inline('A1', 'Hidden work'))}</sheetData></worksheet>` }])
  ];
  for (const value of fixtures) {
    const result = extractWorkbookText(value);
    assert.equal(result.reviewable, false);
    assert.match(result.textContent, /A1: Hidden work/);
  }
});

test('embedded visual work, comments, objects, and external data await manual review', () => {
  for (const name of ['xl/media/image1.png', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml', 'xl/embeddings/oleObject1.bin', 'xl/comments1.xml', 'xl/connections.xml', 'xl/externalLinks/externalLink1.xml', 'xl/queryTables/queryTable1.xml', 'xl/vbaProject.bin']) {
    const value = archive();
    value.names.add(name);
    assert.equal(extractWorkbookText(value).reviewable, false, name);
    assert.match(extractWorkbookText(value).textContent, /A1: Product/);
  }
  const value = archive([{ name: 'Drawings', text: worksheet(row(1, inline('A1', 'Explanation'))).replace('</worksheet>', '<drawing xmlns:r="' + OFFICE_REL + '" r:id="drawing1"/></worksheet>') }]);
  assert.equal(extractWorkbookText(value).reviewable, false);
});

test('external relationships never resolve or fetch targets', () => {
  for (const target of ['https://example.invalid/source', 'file:///private/book.xlsx', '../source.xlsx']) {
    const value = archive([], [['xl/worksheets/sheet1.xml', worksheet(row(1, inline('A1', 'Data')))], ['xl/worksheets/_rels/sheet1.xml.rels', rels(relationship('external', 'hyperlink', target, 'TargetMode="External"'))]]);
    assert.equal(extractWorkbookText(value).reviewable, false);
  }
  const value = archive();
  replacePart(value, 'xl/worksheets/_rels/sheet1.xml.rels', rels(relationship('external', 'hyperlink', 'https://example.invalid/source', 'TargetMode="External"')));
  assert.equal(extractWorkbookText(value).reviewable, false);
  assert.match(extractWorkbookText(value).textContent, /A1: Product/);
});

test('external, DDE, and web formulas are retained as inert text for manual review', () => {
  for (const expression of ["'[other.xlsx]January'!A1", "cmd|' /C calc'!A0", 'WEBSERVICE(&quot;https://example.invalid&quot;)', 'HYPERLINK(&quot;https://example.invalid&quot;,&quot;Source&quot;)', 'RTD(&quot;server&quot;,,&quot;topic&quot;)']) {
    const result = extractWorkbookText(archive([{ name: 'External', text: worksheet(row(1, formula('A1', expression, '7'))) }]));
    assert.equal(result.reviewable, false, expression);
    assert.match(result.textContent, /A1: formula/);
    assert.match(result.textContent, /cached 7/);
  }
});

test('unsafe XML and malformed parts never escape as extraction exceptions', () => {
  const unsafe = [
    '<!DOCTYPE worksheet [<!ENTITY work SYSTEM "file:///private">]><worksheet/>',
    '<!DOCTYPE worksheet><worksheet/>',
    `<worksheet xmlns="${MAIN}"><sheetData>&undefined;</sheetData></worksheet>`,
    `<worksheet xmlns="${MAIN}"><sheetData>`,
    `<worksheet xmlns="${MAIN}"><sheetData></worksheet>`,
    '<worksheet xmlns="wrong"><sheetData/></worksheet>'
  ];
  for (const text of unsafe) {
    const result = extractWorkbookText(archive([{ name: 'Damaged', text }]));
    assert.equal(result.reviewable, false);
  }
  for (const name of ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels']) {
    const value = archive();
    value.xml.set(name, '<broken>');
    assert.equal(extractWorkbookText(value).reviewable, false);
  }
});

test('missing, orphaned, repeated, or unsafe worksheet relationships await manual review', () => {
  const missing = archive();
  missing.xml.delete('xl/worksheets/sheet1.xml');
  const orphan = archive([], [['xl/worksheets/hidden.xml', worksheet(row(1, cell('A1', '1')))]]);
  const unsafe = archive([{ name: 'Unsafe', target: '../../../private.xml', text: worksheet(row(1, cell('A1', '1'))) }]);
  const duplicate = archive([{ name: 'First', target: 'worksheets/sheet1.xml', text: worksheet(row(1, cell('A1', '1'))) }, { name: 'Second', target: 'worksheets/sheet1.xml', text: worksheet(row(1, cell('A1', '2'))) }]);
  for (const value of [missing, orphan, unsafe, duplicate]) assert.equal(extractWorkbookText(value).reviewable, false);
});

test('unreadable shared strings and duplicate or invalid coordinates cannot be auto-reviewed', () => {
  for (const text of [
    worksheet(row(1, cell('A1', '9', 's'))),
    worksheet(row(1, cell('A1', '1') + cell('A1', '2'))),
    worksheet(row(1, cell('XFE1', '1'))),
    worksheet(row(1, cell('A1048577', '1'))),
    worksheet(row(1, formula('A1', '', '2', 't="shared" si="99"'))),
    worksheet(row(1, cell('A1', '2', 'b')))
  ]) assert.equal(extractWorkbookText(archive([{ name: 'Invalid', text }])).reviewable, false);
});

test('text, worksheet, cell, XML size, and depth limits keep partial work manual', () => {
  const limited = extractWorkbookText(archive(), { maxTextLength: 20 });
  assert.equal(limited.textContent.length, 20);
  assert.equal(limited.reviewable, false);
  const sheets = archive(Array.from({ length: 101 }, (_, index) => ({ name: `Sheet ${index}`, text: worksheet(row(1, inline('A1', 'Work'))) })));
  const sheetsResult = extractWorkbookText(sheets);
  assert.equal(sheetsResult.reviewable, false);
  assert.doesNotMatch(sheetsResult.textContent, /Worksheet: Sheet 100\b/);
  const manyCells = archive([{ name: 'Many cells', text: worksheet(Array.from({ length: 10001 }, (_, index) => row(index + 1, cell(`A${index + 1}`, ''))).join('')) }]);
  assert.equal(extractWorkbookText(manyCells).reviewable, false);
  const huge = archive([{ name: 'Huge', text: 'x'.repeat(5 * 1024 * 1024 + 1) }]);
  assert.equal(extractWorkbookText(huge).reviewable, false);
  const deep = archive([{ name: 'Deep', text: `<worksheet xmlns="${MAIN}">${'<a>'.repeat(130)}${'</a>'.repeat(130)}</worksheet>` }]);
  assert.equal(extractWorkbookText(deep).reviewable, false);
});

test('empty or unsupported worksheets cannot be approved from their names alone', () => {
  assert.equal(extractWorkbookText(archive([{ name: 'I completed every requirement', text: worksheet('') }])).reviewable, false);
  assert.equal(extractWorkbookText(archive([{ name: 'Chart', kind: 'chartsheet', text: `<chartsheet xmlns="${MAIN}"/>` }])).reviewable, false);
});

test('defined names retain named formulas and hidden or external names force manual review', () => {
  const value = archive();
  value.xml.set('xl/workbook.xml', value.xml.get('xl/workbook.xml').replace('</workbook>', '<definedNames><definedName name="Total">SUM(January!A1:A2)</definedName></definedNames></workbook>'));
  assert.match(extractWorkbookText(value).textContent, /Defined name Total: SUM\(January!A1:A2\)/);
  assert.equal(extractWorkbookText(value).reviewable, true);
  value.xml.set('xl/workbook.xml', value.xml.get('xl/workbook.xml').replace('name="Total"', 'name="Total" hidden="1"'));
  assert.equal(extractWorkbookText(value).reviewable, false);
});

test('programmer errors are distinct from malformed document data', () => {
  assert.throws(() => extractWorkbookText({}), TypeError);
  for (const maxTextLength of [0, -1, NaN, 1.5, '20']) assert.throws(() => extractWorkbookText(archive(), { maxTextLength }), RangeError);
});
