/**
 * ==============================================================================
 * 🗄️ SQL DATABASE EXPORTER FOR EVENT TICKETS
 * ==============================================================================
 * Exports Google Sheets ticket records into clean, optimized SQL files ready
 * for phpMyAdmin, cPanel, and MySQL/MariaDB database imports.
 * ==============================================================================
 */

/**
 * Generates an optimized .sql file and presents a modal dialog with
 * direct file download and clipboard copy capabilities.
 */
function exportToSQLFile() {
  try {
    const ss = (typeof getSpreadsheet === 'function')
      ? getSpreadsheet()
      : ((typeof SPREADSHEET_ID !== 'undefined' && SPREADSHEET_ID)
          ? SpreadsheetApp.openById(SPREADSHEET_ID)
          : SpreadsheetApp.getActiveSpreadsheet());

    const sheet = ss.getSheetByName("Ticket List");
    if (!sheet) {
      throw new Error("Sheet 'Ticket List' not found. Please run ticket generation first.");
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      throw new Error("No ticket data found in 'Ticket List' sheet.");
    }

    const eventName = (typeof CONFIG !== 'undefined' && CONFIG.EVENT_CODE) ? CONFIG.EVENT_CODE : "Event";
    const now = new Date();
    const timeZone = Session.getScriptTimeZone();

    // SQL Header
    let sqlContent = `-- ==============================================================================\n`;
    sqlContent += `-- TICKET DATABASE DUMP: ${eventName}\n`;
    sqlContent += `-- Generated at: ${Utilities.formatDate(now, timeZone, "yyyy-MM-dd HH:mm:ss")} (${timeZone})\n`;
    sqlContent += `-- Total Tickets: ${data.length - 1}\n`;
    sqlContent += `-- ==============================================================================\n\n`;

    sqlContent += `SET FOREIGN_KEY_CHECKS = 0;\n`;
    sqlContent += `SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n`;
    sqlContent += `SET time_zone = "+00:00";\n\n`;

    // Table Schema definition (clean indexes, no redundant PK index)
    sqlContent += `-- --------------------------------------------------------\n`;
    sqlContent += `-- Table structure for table \`tickets\`\n`;
    sqlContent += `-- --------------------------------------------------------\n`;
    sqlContent += `DROP TABLE IF EXISTS \`tickets\`;\n\n`;
    sqlContent += `CREATE TABLE \`tickets\` (\n`;
    sqlContent += `  \`ticket_id\` VARCHAR(50) NOT NULL,\n`;
    sqlContent += `  \`ticket_type\` VARCHAR(10) NOT NULL,\n`;
    sqlContent += `  \`security_token\` VARCHAR(20) NOT NULL,\n`;
    sqlContent += `  \`validation_hash\` VARCHAR(20) NOT NULL,\n`;
    sqlContent += `  \`qr_code_link\` TEXT,\n`;
    sqlContent += `  \`status\` VARCHAR(30) NOT NULL DEFAULT 'Not Checked-In',\n`;
    sqlContent += `  \`created_at\` DATETIME NOT NULL,\n`;
    sqlContent += `  \`checkin_time\` DATETIME NULL DEFAULT NULL,\n`;
    sqlContent += `  PRIMARY KEY (\`ticket_id\`),\n`;
    sqlContent += `  INDEX \`idx_token\` (\`security_token\`),\n`;
    sqlContent += `  INDEX \`idx_type\` (\`ticket_type\`),\n`;
    sqlContent += `  INDEX \`idx_status\` (\`status\`)\n`;
    sqlContent += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`;

    // Process rows into batched INSERT statements
    const rowValues = [];
    const defaultDateStr = Utilities.formatDate(now, timeZone, "yyyy-MM-dd HH:mm:ss");

    for (let i = 1; i < data.length; i++) {
      const row = data[i];

      const ticketId = escapeSql(row[0]);
      const ticketType = escapeSql(row[1]);
      const securityToken = escapeSql(row[2]);
      const validationHash = escapeSql(String(row[3] || '').replace(/^'/, '').trim());
      const qrCodeLink = escapeSql(row[4]);
      const status = escapeSql(row[5] || "Not Checked-In");

      // Handle timestamps safely
      let createdAtStr = defaultDateStr;
      let checkinTimeSql = "NULL";

      const rawTime = row[6];
      if (rawTime instanceof Date) {
        createdAtStr = Utilities.formatDate(rawTime, timeZone, "yyyy-MM-dd HH:mm:ss");
      }

      if (status === "Checked-In") {
        checkinTimeSql = `'${createdAtStr}'`;
      }

      const valuesTuple = `('${ticketId}', '${ticketType}', '${securityToken}', '${validationHash}', '${qrCodeLink}', '${status}', '${createdAtStr}', ${checkinTimeSql})`;
      rowValues.push(valuesTuple);
    }

    // Chunk rows into blocks of 250 to avoid MySQL max_allowed_packet limits
    const CHUNK_SIZE = 250;
    sqlContent += `-- --------------------------------------------------------\n`;
    sqlContent += `-- Dumping data for table \`tickets\` (${rowValues.length} rows)\n`;
    sqlContent += `-- --------------------------------------------------------\n`;

    for (let c = 0; c < rowValues.length; c += CHUNK_SIZE) {
      const chunk = rowValues.slice(c, c + CHUNK_SIZE);
      sqlContent += `INSERT INTO \`tickets\` (\`ticket_id\`, \`ticket_type\`, \`security_token\`, \`validation_hash\`, \`qr_code_link\`, \`status\`, \`created_at\`, \`checkin_time\`) VALUES\n`;
      sqlContent += chunk.join(",\n");
      sqlContent += `;\n\n`;
    }

    sqlContent += `-- Optimization\n`;
    sqlContent += `ANALYZE TABLE \`tickets\`;\n`;
    sqlContent += `SET FOREIGN_KEY_CHECKS = 1;\n`;

    Logger.log(`✅ SQL export generated! Total tickets: ${rowValues.length}, Size: ${Math.round(sqlContent.length / 1024)} KB`);

    // Safe JSON embedding to prevent script tag injection
    const safeSqlJson = JSON.stringify(sqlContent).replace(/<\/script/gi, '<\\/script');

    const htmlOutput = HtmlService.createHtmlOutput(
      `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 24px; max-width: 820px; margin: 0 auto; color: #202124; line-height: 1.5; }
          h2 { color: #1a73e8; margin-top: 0; display: flex; align-items: center; gap: 8px; }
          .card { background: #e8f0fe; border-left: 4px solid #1a73e8; padding: 16px; border-radius: 4px; margin: 16px 0; }
          .btn-group { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
          .btn { background: #1a73e8; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
          .btn:hover { background: #1557b0; }
          .btn-secondary { background: #fff; color: #3c4043; border: 1px solid #dadce0; }
          .btn-secondary:hover { background: #f1f3f4; }
          textarea { width: 100%; height: 260px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; padding: 12px; border: 1px solid #dadce0; border-radius: 6px; box-sizing: border-box; background: #f8f9fa; }
          ol { padding-left: 20px; line-height: 1.8; color: #3c4043; }
          .badge { background: #1a73e8; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
        </style>
      </head>
      <body>
        <h2>🗄️ SQL Export Ready</h2>
        <div class="card">
          <div><strong>Event:</strong> ${eventName}</div>
          <div><strong>Total Tickets:</strong> <span class="badge">${rowValues.length}</span> &nbsp;|&nbsp; <strong>Payload Size:</strong> ${Math.round(sqlContent.length / 1024)} KB</div>
          <div style="margin-top: 6px; font-size: 13px; color: #5f6368;">Includes full schema, batched multi-row inserts, and indexes for fast lookups.</div>
        </div>

        <div class="btn-group">
          <button class="btn" onclick="downloadSQL()">⬇️ Download tickets_import.sql</button>
          <button class="btn btn-secondary" onclick="copySQL()">📋 Copy to Clipboard</button>
        </div>

        <h3>📋 Import to phpMyAdmin / MySQL:</h3>
        <ol>
          <li>Click <strong>Download tickets_import.sql</strong> above</li>
          <li>Log in to your cPanel / hosting control panel and open <strong>phpMyAdmin</strong></li>
          <li>Select your database from the left navigation panel</li>
          <li>Click the <strong>Import</strong> tab in the top menu</li>
          <li>Choose <code>tickets_import.sql</code> and click <strong>Go / Import</strong></li>
          <li>All tickets are now imported and ready for production web queries!</li>
        </ol>

        <h3>SQL Preview:</h3>
        <textarea id="sqlContent" readonly>${sqlContent.substring(0, 1500)}...\n\n-- [Truncated preview: download file to view all ${rowValues.length} rows]</textarea>

        <script>
          const fullSQL = ${safeSqlJson};

          function downloadSQL() {
            const blob = new Blob([fullSQL], { type: 'application/sql;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tickets_import.sql';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }

          function copySQL() {
            navigator.clipboard.writeText(fullSQL).then(() => {
              alert('✅ SQL copied to clipboard! You can paste it directly into phpMyAdmin SQL tab.');
            }).catch(err => {
              alert('Could not copy automatically. Please select all and copy from preview box.');
            });
          }
        </script>
      </body>
      </html>`
    ).setWidth(880).setHeight(680);

    SpreadsheetApp.getUi().showModalDialog(htmlOutput, `SQL Export - ${eventName}`);

  } catch (error) {
    Logger.log("❌ Error during SQL export: " + error.toString());
    try {
      SpreadsheetApp.getUi().alert('❌ Export Failed', error.message, SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
      // Offline/headless context
    }
  }
}

/**
 * Escapes characters for safe SQL string literal embedding.
 * Handles single quotes, double quotes, backslashes, NUL bytes, newlines, and carriage returns.
 *
 * @param {*} str Input value
 * @returns {string} Escaped string
 */
function escapeSql(str) {
  if (str == null) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
}

/**
 * Quick diagnostic test exporting the first 10 ticket rows to Logger.
 */
function testSQLExport() {
  try {
    const ss = (typeof getSpreadsheet === 'function')
      ? getSpreadsheet()
      : SpreadsheetApp.getActiveSpreadsheet();

    const sheet = ss.getSheetByName("Ticket List");
    const data = sheet.getRange(1, 1, 11, 7).getValues();

    let sqlContent = "-- TEST EXPORT (Sample 10 Tickets)\n\n";
    sqlContent += "INSERT INTO `tickets` (`ticket_id`, `ticket_type`, `security_token`, `validation_hash`, `qr_code_link`, `status`, `created_at`, `checkin_time`) VALUES\n";

    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const ticketId = escapeSql(row[0]);
      const ticketType = escapeSql(row[1]);
      const securityToken = escapeSql(row[2]);
      const validationHash = escapeSql(String(row[3] || '').replace(/^'/, '').trim());
      const qrCodeLink = escapeSql(row[4]);
      const status = escapeSql(row[5] || "Not Checked-In");
      const timestamp = '2026-11-04 12:00:00';

      rows.push(`('${ticketId}', '${ticketType}', '${securityToken}', '${validationHash}', '${qrCodeLink}', '${status}', '${timestamp}', NULL)`);
    }

    sqlContent += rows.join(",\n") + ";\n";
    Logger.log("TEST SQL OUTPUT:\n" + sqlContent);
    return sqlContent;

  } catch (error) {
    Logger.log("❌ Test SQL export failed: " + error.toString());
  }
}
