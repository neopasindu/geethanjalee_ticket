const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMockEnvironment } = require('./mock_gas');

function loadSystem(env) {
  const codeGs = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const sqlGs = fs.readFileSync(path.join(__dirname, '..', 'sqlSheet.gs'), 'utf8');

  const sandbox = {
    ...env,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(codeGs, sandbox);
  vm.runInContext(sqlGs, sandbox);
  return sandbox;
}

test('generateSecureToken produces uniform base32 tokens without ambiguous chars', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const token8 = ctx.generateSecureToken(8);
  assert.equal(token8.length, 8);
  assert.match(token8, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

  // Verify none of the ambiguous chars 0, 1, I, O are present
  assert.doesNotMatch(token8, /[01IO]/);

  const token16 = ctx.generateSecureToken(16);
  assert.equal(token16.length, 16);
  assert.match(token16, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);

  // Uniqueness check
  const set = new Set();
  for (let i = 0; i < 200; i++) {
    const t = ctx.generateSecureToken(8);
    set.add(t);
  }
  assert.equal(set.size, 200, 'Tokens must be highly unique');
});

test('generateValidationHash is deterministic and collision-resistant', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const hash1 = ctx.generateValidationHash('TICKET-D-0001', 'TOKEN123');
  const hash2 = ctx.generateValidationHash('TICKET-D-0001', 'TOKEN123');
  assert.equal(hash1.length, 8);
  assert.equal(hash1, hash2, 'Hash must be deterministic');
  assert.match(hash1, /^[0-9A-F]{8}$/, 'Must be uppercase hex');

  const hashDiffToken = ctx.generateValidationHash('TICKET-D-0001', 'TOKEN999');
  assert.notEqual(hash1, hashDiffToken, 'Different token must produce different hash');

  const hashDiffTicket = ctx.generateValidationHash('TICKET-D-0002', 'TOKEN123');
  assert.notEqual(hash1, hashDiffTicket, 'Different ticket ID must produce different hash');
});

test('setupSheet formats header and sets valid text format without bounds overflow', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const sheet = ctx.setupSheet();
  assert.equal(sheet.name, 'Ticket List');
  assert.equal(sheet.rows[0][0], 'Ticket ID');
  assert.equal(sheet.rows[0][3], 'Validation Hash');
  assert.equal(sheet.rows[0][6], 'Timestamp');
  assert.equal(sheet.lastNumberFormat, '@', 'Must use valid @ format for plain text');
});

test('generateQRCodes correctly detects sequence beyond Type D tickets (fixing [A-C] bug)', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  // Pre-seed an existing Type D ticket
  sheet.getRange(2, 1, 1, 7).setValues([["TICKET-D-0042", "D", "SEC42", "'HASH42", "https://qr", "Not Checked-In", new Date()]]);

  // Set small batch quantity for test
  ctx.CONFIG.TICKET_QUANTITY = 3;
  ctx.generateQRCodes();

  assert.equal(sheet.rows.length, 5, 'Header + 1 existing + 3 new tickets = 5 rows');
  assert.equal(sheet.rows[2][0], 'TICKET-D-0043', 'Must continue numbering from 43!');
  assert.equal(sheet.rows[3][0], 'TICKET-D-0044');
  assert.equal(sheet.rows[4][0], 'TICKET-D-0045');
});

test('checkInTicket successfully validates and marks ticket checked-in', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  const ticketId = 'TICKET-D-0001';
  const token = 'SEC12345';
  const hash = ctx.generateValidationHash(ticketId, token);

  // Stored in sheet with apostrophe prefix
  sheet.getRange(2, 1, 1, 7).setValues([[ticketId, 'D', token, "'" + hash, 'https://qr', 'Not Checked-In', new Date()]]);

  // Check in
  const result = ctx.checkInTicket(`${ticketId}-${token}`);
  assert.equal(result.success, true);
  assert.match(result.message, /checked in successfully/);

  // Verify sheet state was updated
  assert.equal(sheet.rows[1][5], 'Checked-In');
  assert.equal(Object.prototype.toString.call(sheet.rows[1][6]), '[object Date]', 'Check-in timestamp must be a Date');
});

test('checkInTicket prevents duplicate check-in (double entry)', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  const ticketId = 'TICKET-D-0001';
  const token = 'SEC12345';
  const hash = ctx.generateValidationHash(ticketId, token);

  sheet.getRange(2, 1, 1, 7).setValues([[ticketId, 'D', token, "'" + hash, 'https://qr', 'Checked-In', new Date('2026-11-04T10:00:00Z')]]);

  const result = ctx.checkInTicket(`${ticketId}-${token}`);
  assert.equal(result.success, false);
  assert.equal(result.alreadyCheckedIn, true);
  assert.match(result.message, /already checked in/);
});

test('checkInTicket flags forged security tokens as INVALID', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  const ticketId = 'TICKET-D-0001';
  const realToken = 'SEC12345';
  const forgedToken = 'FAKE9999';
  const hash = ctx.generateValidationHash(ticketId, realToken);

  sheet.getRange(2, 1, 1, 7).setValues([[ticketId, 'D', realToken, "'" + hash, 'https://qr', 'Not Checked-In', new Date()]]);

  const result = ctx.checkInTicket(`${ticketId}-${forgedToken}`);
  assert.equal(result.success, false);
  assert.match(result.message, /Token mismatch/);
  assert.equal(sheet.rows[1][5], 'INVALID', 'Forged ticket must be flagged INVALID');
});

test('checkInTicket handles barcode scanner input with whitespace and carriage returns', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  const ticketId = 'TICKET-D-0005';
  const token = 'SEC88888';
  const hash = ctx.generateValidationHash(ticketId, token);

  sheet.getRange(2, 1, 1, 7).setValues([[ticketId, 'D', token, "'" + hash, 'https://qr', 'Not Checked-In', new Date()]]);

  // Barcode scanner sends code with trailing \r\n and whitespace
  const rawScannerInput = `  ${ticketId}-${token.toLowerCase()}\r\n`;
  const result = ctx.checkInTicket(rawScannerInput);
  assert.equal(result.success, true);
  assert.equal(sheet.rows[1][5], 'Checked-In');
});

test('verifyTicket inspects status without mutating sheet state', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  const ticketId = 'TICKET-D-0010';
  const token = 'SEC10101';
  const hash = ctx.generateValidationHash(ticketId, token);

  sheet.getRange(2, 1, 1, 7).setValues([[ticketId, 'D', token, "'" + hash, 'https://qr', 'Not Checked-In', new Date()]]);

  const result = ctx.verifyTicket(`${ticketId}-${token}`);
  assert.equal(result.valid, true);
  assert.equal(result.status, 'Not Checked-In');
  assert.equal(sheet.rows[1][5], 'Not Checked-In', 'verifyTicket must NOT alter sheet status');
});

test('getTicketStats tallies accurate event summary and breakdown by type', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  sheet.getRange(2, 1, 3, 7).setValues([
    ['TICKET-A-0001', 'A', 'T1', 'H1', '', 'Checked-In', new Date()],
    ['TICKET-A-0002', 'A', 'T2', 'H2', '', 'Not Checked-In', new Date()],
    ['TICKET-D-0001', 'D', 'T3', 'H3', '', 'INVALID', new Date()]
  ]);

  const stats = ctx.getTicketStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.checkedIn, 1);
  assert.equal(stats.notCheckedIn, 1);
  assert.equal(stats.invalid, 1);
  assert.equal(stats.byType['A'].total, 2);
  assert.equal(stats.byType['A'].checkedIn, 1);
  assert.equal(stats.byType['D'].invalid, 1);
});

test('doGet serves Index.html scanner UI or returns JSON for API queries', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  // 1. Web App UI output
  const webAppOutput = ctx.doGet({});
  assert(webAppOutput, 'doGet must return HtmlOutput');

  // 2. REST API: action=stats
  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);
  sheet.getRange(2, 1, 1, 7).setValues([['TICKET-D-0001', 'D', 'TOK', 'HASH', '', 'Checked-In', new Date()]]);

  const apiStatsOutput = ctx.doGet({ parameter: { action: 'stats' } });
  const statsJson = JSON.parse(apiStatsOutput.getContent());
  assert.equal(statsJson.success, true);
  assert.equal(statsJson.stats.total, 1);
  assert.equal(statsJson.stats.checkedIn, 1);

  // 3. REST API: action=verify
  const token = 'TOK';
  const hash = ctx.generateValidationHash('TICKET-D-0001', token);
  sheet.getRange(2, 4).setValue("'" + hash);

  const apiVerifyOutput = ctx.doGet({ parameter: { action: 'verify', code: `TICKET-D-0001-${token}` } });
  const verifyJson = JSON.parse(apiVerifyOutput.getContent());
  assert.equal(verifyJson.valid, true);
  assert.equal(verifyJson.ticketId, 'TICKET-D-0001');
});

test('sqlSheet export produces clean schema, chunked inserts, and strict-mode nulls', () => {
  const env = createMockEnvironment();
  const ctx = loadSystem(env);

  // escapeSql tests
  assert.equal(ctx.escapeSql("O'Connor"), "O\\'Connor");
  assert.equal(ctx.escapeSql('Test "Quotes"'), 'Test \\"Quotes\\"');
  assert.equal(ctx.escapeSql('Line1\nLine2\r'), 'Line1\\nLine2\\r');
  assert.equal(ctx.escapeSql(null), '');

  const ss = env.SpreadsheetApp.openById('test');
  const sheet = ss.insertSheet('Ticket List');
  sheet.getRange(1, 1, 1, 7).setValues([["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]]);

  sheet.getRange(2, 1, 2, 7).setValues([
    ['TICKET-D-0001', 'D', 'SEC1', "'HASH1", 'https://qr1', 'Not Checked-In', new Date('2026-11-04T12:00:00Z')],
    ['TICKET-D-0002', 'D', 'SEC2', "'HASH2", 'https://qr2', 'Checked-In', new Date('2026-11-04T12:30:00Z')]
  ]);

  const sampleSql = ctx.testSQLExport();
  assert(sampleSql.includes("INSERT INTO `tickets` (`ticket_id`, `ticket_type`, `security_token`, `validation_hash`, `qr_code_link`, `status`, `created_at`, `checkin_time`) VALUES"));
  assert(sampleSql.includes("'TICKET-D-0001'"));
  assert(sampleSql.includes("NULL"), 'Unchecked ticket checkin_time must be NULL for SQL strict mode');
});
