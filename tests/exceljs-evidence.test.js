const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { formatSpreadsheetCell } = require('../workbook-evidence');
const { inspectEvidenceFile, extractUploadedEvidence } = require('../evidence-files');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbookUpload(build, name = 'evidence.xlsx') {
  const workbook = new ExcelJS.Workbook();
  await build(workbook);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { originalname: name, mimetype: XLSX_MIME, size: buffer.length, buffer };
}

function assertMetadata(result, expected = {}) {
  assert.ok(result.metadata, 'spreadsheet extraction includes its coverage metadata');
  assert.deepEqual({
    sheetCount: result.metadata.sheetCount,
    analysedSheets: result.metadata.analysedSheets,
    rowLimitPerSheet: result.metadata.rowLimitPerSheet,
    columnLimitPerSheet: result.metadata.columnLimitPerSheet,
    truncated: result.metadata.truncated
  }, {
    sheetCount: 1,
    analysedSheets: 1,
    rowLimitPerSheet: 100,
    columnLimitPerSheet: 30,
    truncated: false,
    ...expected
  });
}

test('ExcelJS cell formatting preserves primitives, dates, rich text, hyperlinks, and errors', () => {
  const cases = [
    [null, ''],
    [undefined, ''],
    ['Completed research', 'Completed research'],
    [42.5, '42.5'],
    [0, '0'],
    [true, 'true'],
    [false, 'false'],
    [new Date('2026-01-12T10:20:30.000Z'), '2026-01-12T10:20:30.000Z'],
    [{ richText: [{ text: 'Gross ' }, { font: { bold: true }, text: 'profit' }] }, 'Gross profit'],
    [{ text: 'Supporting report', hyperlink: 'https://example.invalid/report' }, 'Supporting report'],
    [{ error: '#DIV/0!' }, '#DIV/0!']
  ];
  for (const [value, expected] of cases) assert.equal(formatSpreadsheetCell(value), expected);
});

test('ExcelJS formula formatting includes zero and false caches without calculating results', () => {
  for (const [value, expected] of [
    [{ formula: '1+1', result: 91 }, 'FORMULA: 1+1 → 91'],
    [{ formula: '1+1', result: 0 }, 'FORMULA: 1+1 → 0'],
    [{ formula: 'TRUE()', result: false }, 'FORMULA: TRUE() → false'],
    [{ formula: 'SUM(A1:A2)' }, 'FORMULA: SUM(A1:A2)'],
    [{ formula: '1/0', result: { error: '#DIV/0!' } }, 'FORMULA: 1/0 → #DIV/0!']
  ]) assert.equal(formatSpreadsheetCell(value), expected);
});

test('real XLSX uploads preserve sheet order, row numbers, sparse columns, and skip blank rows', async () => {
  const upload = await workbookUpload(workbook => {
    const january = workbook.addWorksheet('January');
    january.getCell('A1').value = 'Product';
    january.getCell('C1').value = 'Quantity';
    january.getCell('B3').value = false;
    january.getCell('A4').value = '   ';
    workbook.addWorksheet('February').getCell('A2').value = 12;
  });
  const result = await inspectEvidenceFile(upload);
  assert.equal(result.reviewable, true);
  assert.equal(result.fileType, 'spreadsheet');
  assert.equal(result.mimeType, XLSX_MIME);
  assert.equal(result.textContent,
    'WORKSHEET: January\nROW 1: Product |  | Quantity\nROW 3:  | false\n\nWORKSHEET: February\nROW 2: 12');
  assertMetadata(result, { sheetCount: 2, analysedSheets: 2 });
  assert.deepEqual(result.buffer, upload.buffer);
});

test('real XLSX extraction uses typed values for dates, booleans, numbers, rich text, and errors', async () => {
  const result = await inspectEvidenceFile(await workbookUpload(workbook => {
    const sheet = workbook.addWorksheet('Typed data');
    sheet.addRow([
      'Revenue', 42.5, 0, true, false, new Date('2026-01-12T00:00:00.000Z'),
      { richText: [{ text: 'Gross ' }, { text: 'profit', font: { bold: true } }] },
      { error: '#N/A' }
    ]);
  }));
  assert.equal(result.reviewable, true);
  assert.equal(result.textContent,
    'WORKSHEET: Typed data\nROW 1: Revenue | 42.5 | 0 | true | false | 2026-01-12T00:00:00.000Z | Gross profit | #N/A');
  assertMetadata(result);
});

test('real XLSX formulas retain deliberately inconsistent caches and never execute uploaded text', async () => {
  const key = '__careerKraftSpreadsheetExecuted';
  globalThis[key] = false;
  try {
    const result = await inspectEvidenceFile(await workbookUpload(workbook => {
      workbook.addWorksheet('Calculations').addRow([
        { formula: '1+1', result: 91 },
        { formula: '1+1', result: 0 },
        { formula: 'TRUE()', result: false },
        { formula: 'SUM(A1:A2)' },
        `globalThis.${key} = true;`
      ]);
    }));
    assert.equal(result.reviewable, true);
    assert.match(result.textContent, /FORMULA: 1\+1 → 91/);
    assert.match(result.textContent, /FORMULA: 1\+1 → 0/);
    assert.match(result.textContent, /FORMULA: TRUE\(\) → false/);
    assert.match(result.textContent, /FORMULA: SUM\(A1:A2\) \|/);
    assert.match(result.textContent, /globalThis\.__careerKraftSpreadsheetExecuted = true;/);
    assert.equal(globalThis[key], false);
  } finally {
    delete globalThis[key];
  }
});

test('five sheets, row 100, and column 30 are included without truncation', async () => {
  const result = await inspectEvidenceFile(await workbookUpload(workbook => {
    for (let index = 1; index <= 5; index++) {
      const sheet = workbook.addWorksheet(`Sheet ${index}`);
      sheet.getCell('A1').value = `Start ${index}`;
      sheet.getCell('AD100').value = `Boundary ${index}`;
    }
  }));
  assert.equal(result.reviewable, true);
  assertMetadata(result, { sheetCount: 5, analysedSheets: 5 });
  assert.equal((result.textContent.match(/^WORKSHEET:/gm) || []).length, 5);
  const boundaryRows = result.textContent.split('\n').filter(line => line.startsWith('ROW 100:'));
  assert.equal(boundaryRows.length, 5);
  for (let index = 0; index < boundaryRows.length; index++) {
    const cells = boundaryRows[index].replace(/^ROW 100: /, '').split(' | ');
    assert.equal(cells.length, 30);
    assert.equal(cells[29], `Boundary ${index + 1}`);
  }
});

test('a sixth sheet is omitted and partial workbook text remains manual', async () => {
  const result = await inspectEvidenceFile(await workbookUpload(workbook => {
    for (let index = 1; index <= 6; index++) {
      workbook.addWorksheet(`Sheet ${index}`).getCell('A1').value = `Evidence ${index}`;
    }
  }));
  assert.equal(result.reviewable, false);
  assertMetadata(result, { sheetCount: 6, analysedSheets: 5, truncated: true });
  assert.match(result.textContent, /WORKSHEET: Sheet 5\nROW 1: Evidence 5/);
  assert.doesNotMatch(result.textContent, /Sheet 6|Evidence 6/);
  assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
});

test('row 101 and column 31 are omitted and cannot make a partial workbook auto-reviewable', async t => {
  for (const [label, address] of [['row', 'A101'], ['column', 'AE1']]) {
    await t.test(label, async () => {
      const result = await inspectEvidenceFile(await workbookUpload(workbook => {
        const sheet = workbook.addWorksheet('Large worksheet');
        sheet.getCell('A1').value = 'Included evidence';
        sheet.getCell(address).value = 'Excluded evidence';
      }));
      assert.equal(result.reviewable, false);
      assertMetadata(result, { truncated: true });
      assert.match(result.textContent, /Included evidence/);
      assert.doesNotMatch(result.textContent, /Excluded evidence/);
      assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
    });
  }
});

test('XLSX text is capped at 20000 characters and partial text requires manual review', async () => {
  const result = await inspectEvidenceFile(await workbookUpload(workbook => {
    workbook.addWorksheet('Long evidence').getCell('A1').value = 'x'.repeat(21000);
  }));
  assert.equal(result.textContent.length, 20000);
  assert.equal(result.reviewable, false);
  assertMetadata(result, { truncated: true });
  const extracted = await extractUploadedEvidence(result);
  assert.equal(extracted.autoReviewable, false);
  assert.equal(extracted.text.length, 20000);
  assert.equal(extracted.type, 'spreadsheet');
});

test('empty workbooks and worksheets cannot be approved from worksheet names', async t => {
  await t.test('no worksheets', async () => {
    const result = await inspectEvidenceFile(await workbookUpload(() => {}));
    assert.equal(result.reviewable, false);
    assertMetadata(result, { sheetCount: 0, analysedSheets: 0 });
    assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
  });
  await t.test('empty worksheet', async () => {
    const result = await inspectEvidenceFile(await workbookUpload(workbook => {
      workbook.addWorksheet('I completed every requirement');
    }));
    assert.equal(result.reviewable, false);
    assertMetadata(result);
    assert.doesNotMatch(result.textContent, /^ROW /m);
    assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
  });
});

test('hidden worksheets, rows, and columns retain the original workbook for manual review', async t => {
  for (const kind of ['worksheet', 'row', 'column']) {
    await t.test(kind, async () => {
      const upload = await workbookUpload(workbook => {
        const sheet = workbook.addWorksheet('Hidden work');
        sheet.getCell('A1').value = 'Private supporting reasoning';
        if (kind === 'worksheet') sheet.state = 'veryHidden';
        if (kind === 'row') sheet.getRow(1).hidden = true;
        if (kind === 'column') sheet.getColumn(1).hidden = true;
      });
      const result = await inspectEvidenceFile(upload);
      assert.equal(result.reviewable, false);
      assert.deepEqual(result.buffer, upload.buffer);
      assertMetadata(result, { analysedSheets: 0 });
      assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
    });
  }
});

test('hyperlink labels stay readable while external formulas require manual review', async t => {
  for (const [kind, value] of [
    ['hyperlink', { text: 'Supporting report', hyperlink: 'https://example.invalid/report' }],
    ['formula', { formula: 'WEBSERVICE("https://example.invalid/private")', result: 'Cached external value' }]
  ]) {
    await t.test(kind, async () => {
      let fetches = 0;
      t.mock.method(globalThis, 'fetch', () => {
        fetches += 1;
        throw new Error('Uploaded workbook content must not fetch external resources');
      });
      const upload = await workbookUpload(workbook => {
        workbook.addWorksheet('External data').getCell('A1').value = value;
      });
      const result = await inspectEvidenceFile(upload);
      assert.equal(result.reviewable, kind === 'hyperlink');
      if (kind === 'hyperlink') {
        assert.match(result.textContent, /ROW 1: Supporting report/);
        assert.doesNotMatch(result.textContent, /https:\/\/example\.invalid/);
      }
      assert.deepEqual(result.buffer, upload.buffer);
      assertMetadata(result, { analysedSheets: kind === 'hyperlink' ? 1 : 0 });
      assert.equal((await extractUploadedEvidence(result)).autoReviewable, kind === 'hyperlink');
      assert.equal(fetches, 0);
    });
  }
});

test('spreadsheet metadata and typed row text propagate to the upload extraction contract', async () => {
  const upload = await workbookUpload(workbook => {
    workbook.addWorksheet('Reasoning').addRow(['Source', 'Relevant because it records the incident']);
  });
  const inspected = await inspectEvidenceFile(upload);
  const reused = await extractUploadedEvidence(inspected);
  const parsed = await extractUploadedEvidence(upload);
  for (const result of [reused, parsed]) {
    assert.equal(result.type, 'spreadsheet');
    assert.equal(result.autoReviewable, true);
    assert.equal(result.text, inspected.textContent);
    assert.deepEqual(result.metadata, inspected.metadata);
    assertMetadata(result);
    assert.doesNotMatch(result.text, /PK\u0003\u0004|\[Content_Types\]\.xml|<worksheet/);
  }
});

test('defined-name formulas remain reviewable evidence without changing uploaded workbook bytes', async () => {
  const upload = await workbookUpload(workbook => {
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Units', 2]);
    sheet.addRow(['Units', 3]);
  });
  // ExcelJS writes named ranges but drops named expressions from its model.
  // Add the standard workbook definition to the otherwise generated XLSX.
  const archive = await JSZip.loadAsync(upload.buffer);
  const workbookXml = await archive.file('xl/workbook.xml').async('string');
  archive.file('xl/workbook.xml', workbookXml.replace('</workbook>',
    '<definedNames><definedName name="Calculation">SUM(Sheet1!$B$1:$B$2)</definedName></definedNames></workbook>'));
  const buffer = await archive.generateAsync({ type: 'nodebuffer' });
  const originalBytes = Buffer.from(buffer);
  const result = await inspectEvidenceFile({ ...upload, buffer, size: buffer.length });
  assert.equal(result.reviewable, true);
  assert.match(result.textContent, /ROW 1: Units \| 2\nROW 2: Units \| 3/);
  assert.match(result.textContent, /DEFINED NAME: Calculation\nFORMULA: SUM\(Sheet1!\$B\$1:\$B\$2\)/);
  assertMetadata(result);
  assert.deepEqual(buffer, originalBytes);
  assert.deepEqual(result.buffer, originalBytes);
  const extracted = await extractUploadedEvidence(result);
  assert.equal(extracted.autoReviewable, true);
  assert.equal(extracted.text, result.textContent);
});
