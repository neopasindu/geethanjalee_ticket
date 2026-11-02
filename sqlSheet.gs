// ============================================
// EXPORT GOOGLE SHEET TO SQL FILE
// Creates a .sql file you can import directly
// ============================================



function exportToSQLFile() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Ticket List");
    const data = sheet.getDataRange().getValues();
    
    // Start SQL file content
    let sqlContent = "-- Ticket Database Export\n";
    sqlContent += "-- Generated: " + new Date().toString() + "\n\n";
    
    // Create table
    sqlContent += "DROP TABLE IF EXISTS tickets;\n\n";
    sqlContent += "CREATE TABLE tickets (\n";
    sqlContent += "  ticket_id VARCHAR(50) PRIMARY KEY,\n";
    sqlContent += "  ticket_type VARCHAR(10) NOT NULL,\n";
    sqlContent += "  security_token VARCHAR(20) NOT NULL,\n";
    sqlContent += "  validation_hash VARCHAR(20) NOT NULL,\n";
    sqlContent += "  qr_code_link TEXT,\n";
    sqlContent += "  status VARCHAR(30) DEFAULT 'Not Checked-In',\n";
    sqlContent += "  timestamp DATETIME,\n";
    sqlContent += "  checkin_time DATETIME NULL,\n";
    sqlContent += "  INDEX idx_ticket_id (ticket_id),\n";
    sqlContent += "  INDEX idx_token (security_token),\n";
    sqlContent += "  INDEX idx_status (status)\n";
    sqlContent += ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n";
    
    // Insert statements
    sqlContent += "-- Insert ticket data\n";
    sqlContent += "INSERT INTO tickets (ticket_id, ticket_type, security_token, validation_hash, qr_code_link, status, timestamp) VALUES\n";
    
    const insertStatements = [];
    
    // Skip header row, process data
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // Extract and escape data
      const ticketId = escapeSql(row[0]);
      const ticketType = escapeSql(row[1]);
      const securityToken = escapeSql(row[2]);
      const validationHash = escapeSql(String(row[3]).replace(/'/g, '').trim());
      const qrCodeLink = escapeSql(row[4]);
      const status = escapeSql(row[5] || "Not Checked-In");
      
      // Format timestamp
      let timestamp = row[6];
      if (timestamp instanceof Date) {
        timestamp = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      } else {
        timestamp = new Date();
        timestamp = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      }
      
      // Create insert statement
      const values = `('${ticketId}', '${ticketType}', '${securityToken}', '${validationHash}', '${qrCodeLink}', '${status}', '${timestamp}')`;
      insertStatements.push(values);
      
      // Log progress
      if (i % 100 === 0) {
        Logger.log(`Processed ${i} of ${data.length - 1} tickets...`);
      }
    }
    
    // Join all insert statements
    sqlContent += insertStatements.join(",\n");
    sqlContent += ";\n\n";
    
    // Add index optimization
    sqlContent += "-- Optimize table\n";
    sqlContent += "ANALYZE TABLE tickets;\n";
    
    Logger.log("✅ SQL file content generated!");
    Logger.log(`Total tickets: ${insertStatements.length}`);
    
    Logger.log("==========================================");
    Logger.log("✅ SQL FILE GENERATED!");
    Logger.log(`Tickets: ${insertStatements.length}`);
    Logger.log(`Size: ${Math.round(sqlContent.length / 1024)} KB`);
    Logger.log("==========================================");
    
    // Create downloadable HTML with SQL content
    const htmlOutput = HtmlService.createHtmlOutput(
      `<!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          h2 { color: #4285f4; }
          .success { background: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .btn { background: #4285f4; color: white; padding: 12px 24px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; margin: 10px 5px; }
          .btn:hover { background: #3367d6; }
          textarea { width: 100%; height: 300px; font-family: monospace; font-size: 12px; padding: 10px; margin: 10px 0; }
          ol { line-height: 1.8; }
        </style>
      </head>
      <body>
        <h2>✅ SQL File Generated!</h2>
        <div class="success">
          <p><strong>Tickets:</strong> ${insertStatements.length}</p>
          <p><strong>Size:</strong> ${Math.round(sqlContent.length / 1024)} KB</p>
        </div>
        
        <h3>📥 Download SQL File:</h3>
        <button class="btn" onclick="downloadSQL()">⬇️ Download tickets_import.sql</button>
        <button class="btn" onclick="copySQL()">📋 Copy SQL to Clipboard</button>
        
        <h3>📋 How to Import to Namecheap MySQL:</h3>
        <ol>
          <li>Click "Download tickets_import.sql" button above</li>
          <li>Login to Namecheap cPanel</li>
          <li>Open <strong>phpMyAdmin</strong></li>
          <li>Select your database</li>
          <li>Click <strong>Import</strong> tab</li>
          <li>Click <strong>Choose File</strong> and select tickets_import.sql</li>
          <li>Click <strong>Go</strong></li>
          <li>Done! All ${insertStatements.length} tickets imported! ✅</li>
        </ol>
        
        <h3>Preview SQL Content:</h3>
        <textarea id="sqlContent" readonly>${sqlContent.substring(0, 2000)}...
(Full content will be in downloaded file)</textarea>
        
        <script>
          const fullSQL = ${JSON.stringify(sqlContent)};
          
          function downloadSQL() {
            const blob = new Blob([fullSQL], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tickets_import.sql';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert('✅ SQL file downloaded! Now import it in phpMyAdmin.');
          }
          
          function copySQL() {
            navigator.clipboard.writeText(fullSQL).then(() => {
              alert('✅ SQL copied to clipboard! You can paste it directly in phpMyAdmin SQL tab.');
            });
          }
        </script>
      </body>
      </html>`
    ).setWidth(900).setHeight(700);
    
    SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'SQL Export Complete');
    
  } catch (error) {
    Logger.log("❌ Error: " + error.toString());
    SpreadsheetApp.getUi().alert(
      '❌ Export Failed',
      'Error creating SQL file: ' + error.toString(),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

/**
 * Escape special characters for SQL
 */
function escapeSql(str) {
  if (str == null || str === '') return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Create menu
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🗄️ Export to SQL')
    .addItem('📤 Generate SQL File', 'exportToSQLFile')
    .addToUi();
}

/**
 * Test function - exports first 10 tickets
 */
function testSQLExport() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Ticket List");
    const data = sheet.getRange(1, 1, 11, 7).getValues(); // Header + 10 rows
    
    let sqlContent = "-- TEST EXPORT (First 10 tickets)\n\n";
    sqlContent += "CREATE TABLE IF NOT EXISTS tickets (\n";
    sqlContent += "  ticket_id VARCHAR(50) PRIMARY KEY,\n";
    sqlContent += "  ticket_type VARCHAR(10),\n";
    sqlContent += "  security_token VARCHAR(20),\n";
    sqlContent += "  validation_hash VARCHAR(20),\n";
    sqlContent += "  qr_code_link TEXT,\n";
    sqlContent += "  status VARCHAR(30),\n";
    sqlContent += "  timestamp DATETIME\n";
    sqlContent += ");\n\n";
    
    sqlContent += "INSERT INTO tickets VALUES\n";
    
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const ticketId = escapeSql(row[0]);
      const ticketType = escapeSql(row[1]);
      const securityToken = escapeSql(row[2]);
      const validationHash = escapeSql(String(row[3]).replace(/'/g, '').trim());
      const qrCodeLink = escapeSql(row[4]);
      const status = escapeSql(row[5] || "Not Checked-In");
      const timestamp = '2025-11-18 00:00:00';
      
      rows.push(`('${ticketId}', '${ticketType}', '${securityToken}', '${validationHash}', '${qrCodeLink}', '${status}', '${timestamp}')`);
    }
    
    sqlContent += rows.join(",\n") + ";\n";
    
    Logger.log("TEST SQL OUTPUT:");
    Logger.log("==========================================");
    Logger.log(sqlContent);
    Logger.log("==========================================");
    Logger.log("✅ Test export successful! Check the log above.");
    
  } catch (error) {
    Logger.log("❌ Test failed: " + error.toString());
  }
}