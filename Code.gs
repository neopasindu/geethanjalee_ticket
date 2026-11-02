const TICKET_TYPE = "D";        
const TICKET_QUANTITY = 2850;    
const SPREADSHEET_ID = "1Pw7_KsPDCBwDufXr7OoH_FpTO4i7BmDMh_2VS83dZPc";
const EVENT_CODE = "Geethanjalee360";   
const TOKEN_LENGTH = 8;         

// Generate a cryptographically secure random token
function generateSecureToken(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
  let token = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    token += chars.charAt(randomIndex);
  }
  
  return token;
}

function generateValidationHash(ticketId, token) {
  const secret = "YOUR_SECRET_KEY_12345"; 
  const dataToHash = ticketId.trim() + token.trim() + secret + EVENT_CODE;
  
  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    dataToHash,
    Utilities.Charset.UTF_8
  );
  
  let hashHex = '';
  for (let i = 0; i < 4; i++) { 
    const byte = hash[i];
    const hex = (byte < 0 ? byte + 256 : byte).toString(16);
    hashHex += hex.length === 1 ? '0' + hex : hex;
  }
  
  return hashHex.toUpperCase();
}

function setupSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName("Ticket List");
  
  if (!sheet) {
    sheet = ss.insertSheet("Ticket List");
    Logger.log("✅ Created 'Ticket List' sheet");
  }
  
  const firstRow = sheet.getRange(1, 1, 1, 7).getValues()[0];
  if (firstRow[0] !== "Ticket ID") {
    const headers = [["Ticket ID", "Ticket Type", "Security Token", "Validation Hash", "QR Code Link", "Status", "Timestamp"]];
    const headerRange = sheet.getRange(1, 1, 1, 7);
    headerRange.setValues(headers);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#4285f4");
    headerRange.setFontColor("#ffffff");
    
    sheet.setFrozenRows(1);
    Logger.log("✅ Headers added with security columns");
  }
  
  // **FIX: Set validation hash column to plain text format**
  const lastRow = Math.max(sheet.getLastRow(), 1000); // Format more rows for future use
  sheet.getRange(2, 4, lastRow, 1).setNumberFormat('@STRING@'); // Column D (4) = Validation Hash
  
  Logger.log("✅ Sheet is ready!");
  return sheet;
}

function generateQRCodes() {
  try {
    const sheet = setupSheet();
    
    const lastRow = sheet.getLastRow();
    const startRow = lastRow + 1;
    
    let lastTicketNumber = 0;
    if (lastRow > 1) {
      const lastTicketId = sheet.getRange(lastRow, 1).getValue();
      const match = lastTicketId.match(/TICKET-[A-C]-(\d+)/);
      if (match) {
        lastTicketNumber = parseInt(match[1]);
      }
    }
    
    Logger.log(`📝 Starting secure ticket generation...`);
    Logger.log(`   Event Code: ${EVENT_CODE}`);
    Logger.log(`   Type: ${TICKET_TYPE}`);
    Logger.log(`   Quantity: ${TICKET_QUANTITY}`);
    Logger.log(`   Starting from row: ${startRow}`);
    Logger.log(`   Starting ticket number: ${lastTicketNumber + 1}`);
    Logger.log(`   Security: ${TOKEN_LENGTH}-character token + validation hash`);
    
    const batchData = [];
    const usedTokens = new Set(); 
    
    for (let i = 0; i < TICKET_QUANTITY; i++) {
      const ticketNumber = lastTicketNumber + i + 1;
      const ticketId = `TICKET-${TICKET_TYPE}-${Utilities.formatString("%04d", ticketNumber)}`;
      
      let securityToken;
      do {
        securityToken = generateSecureToken(TOKEN_LENGTH);
      } while (usedTokens.has(securityToken)); 
      usedTokens.add(securityToken);
      
      const validationHash = generateValidationHash(ticketId, securityToken);
      
      // **FIX: Prefix with apostrophe to force text format**
      const validationHashText = "'" + validationHash;
      
      const fullTicketCode = `${ticketId}-${securityToken}`;
      const qrData = encodeURIComponent(fullTicketCode);
      
      const qrUrl = `https://quickchart.io/qr?text=${qrData}&size=250&caption=TYPE%20${TICKET_TYPE}%20%7C%20${EVENT_CODE}&captionFontSize=16`;
      
      const timestamp = new Date();
      
      batchData.push([
        ticketId,
        TICKET_TYPE,
        securityToken,
        validationHashText, // Now with apostrophe prefix
        qrUrl,
        "Not Checked-In",
        timestamp
      ]);
      
      if ((i + 1) % 100 === 0) {
        Logger.log(`   Generated ${i + 1}/${TICKET_QUANTITY} tickets...`);
      }
    }
    
    if (batchData.length > 0) {
      sheet.getRange(startRow, 1, batchData.length, 7).setValues(batchData);
    }
    
    sheet.autoResizeColumns(1, 7);
    
    try {
      const statusRange = sheet.getRange(2, 6, sheet.getLastRow() - 1, 1);
      const notCheckedRule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Not Checked-In")
        .setBackground("#fff3cd")
        .setRanges([statusRange])
        .build();
      
      const checkedRule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Checked-In")
        .setBackground("#d4edda")
        .setRanges([statusRange])
        .build();
      
      const invalidRule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("INVALID")
        .setBackground("#f8d7da")
        .setRanges([statusRange])
        .build();
      
      sheet.setConditionalFormatRules([notCheckedRule, checkedRule, invalidRule]);
    } catch (e) {
      Logger.log("⚠️ Conditional formatting failed: " + e);
    }
    
    Logger.log(`✅ Successfully generated ${batchData.length} secure tickets of Type ${TICKET_TYPE}!`);
    Logger.log(`   First ticket: ${batchData[0][0]}-${batchData[0][2]}`);
    Logger.log(`   Last ticket: ${batchData[batchData.length - 1][0]}-${batchData[batchData.length - 1][2]}`);
    
    SpreadsheetApp.getUi().alert(
      '✅ Success!',
      `Generated ${batchData.length} SECURE tickets of Type ${TICKET_TYPE}\n\n` +
      `Event: ${EVENT_CODE}\n` +
      `First: ${batchData[0][0]}-${batchData[0][2]}\n` +
      `Last: ${batchData[batchData.length - 1][0]}-${batchData[batchData.length - 1][2]}\n\n` +
      `🔒 SECURITY FEATURES:\n` +
      `• Each ticket has a unique ${TOKEN_LENGTH}-character security token\n` +
      `• Validation hash prevents forgery\n` +
      `• Event code embedded: ${EVENT_CODE}\n` +
      `• QR codes show "TYPE ${TICKET_TYPE} | ${EVENT_CODE}"\n\n` +
      `To generate more tickets:\n` +
      `1. Change TICKET_TYPE at the top\n` +
      `2. Change TICKET_QUANTITY if needed\n` +
      `3. Run generateQRCodes() again`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    
  } catch (error) {
    Logger.log("❌ Error: " + error.toString());
    SpreadsheetApp.getUi().alert('❌ Error', 'Failed to generate tickets: ' + error.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function checkInTicket(scannedCode) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Ticket List");
    
    const parts = scannedCode.split('-');
    if (parts.length !== 4) {
      return { success: false, message: "❌ Invalid ticket format!" };
    }
    
    const ticketId = `${parts[0]}-${parts[1]}-${parts[2]}`; 
    const scannedToken = parts[3]; 
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === ticketId) {
        const storedToken = data[i][2];
        // **FIX: Remove any whitespace from validation hash**
        const validationHash = String(data[i][3]).replace(/\s+/g, '');
        const status = data[i][5];
        const ticketType = data[i][1];
        
        if (storedToken !== scannedToken) {
          sheet.getRange(i + 1, 6).setValue("INVALID");
          return { 
            success: false, 
            message: "🚨 SECURITY ALERT: Token mismatch! This ticket may be forged.",
            ticketId: ticketId
          };
        }
        
        const computedHash = generateValidationHash(ticketId, scannedToken);
        if (computedHash !== validationHash) {
          sheet.getRange(i + 1, 6).setValue("INVALID");
          return { 
            success: false, 
            message: "🚨 SECURITY ALERT: Invalid signature! This ticket is not authentic.",
            ticketId: ticketId
          };
        }
        
        if (status === "Checked-In") {
          return { 
            success: false, 
            message: "⚠️ Ticket already checked in!",
            ticketId: ticketId,
            ticketType: ticketType,
            timestamp: data[i][6]
          };
        }
        
        sheet.getRange(i + 1, 6).setValue("Checked-In");
        sheet.getRange(i + 1, 7).setValue(new Date());
        
        return { 
          success: true, 
          message: `✅ Valid ticket! ${ticketId} (Type ${ticketType}) checked in successfully!`,
          ticketId: ticketId,
          ticketType: ticketType,
          securityToken: scannedToken
        };
      }
    }
    
    return { success: false, message: "❌ Ticket not found in database!" };
    
  } catch (error) {
    return { success: false, message: "❌ Error: " + error.toString() };
  }
}

function verifyTicket(scannedCode) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Ticket List");
    
    if (!sheet) {
      return { valid: false, message: "Database not found" };
    }
    
    const parts = scannedCode.split('-');
    if (parts.length !== 4) {
      return { valid: false, message: "Invalid ticket format" };
    }
    
    const ticketId = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const scannedToken = parts[3];
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === ticketId) {
        const storedToken = data[i][2];
        // **FIX: Remove any whitespace from validation hash**
        const validationHash = String(data[i][3]).replace(/\s+/g, '');
        const status = data[i][5];
        const ticketType = data[i][1];
        const timestamp = data[i][6];
        
        if (storedToken !== scannedToken) {
          return { 
            valid: false, 
            message: "🚨 SECURITY ALERT: Token mismatch! This ticket may be forged.",
            ticketId: ticketId,
            securityIssue: true
          };
        }
        
        const computedHash = generateValidationHash(ticketId, scannedToken);
        if (computedHash !== validationHash) {
          return { 
            valid: false, 
            message: "🚨 SECURITY ALERT: Invalid signature! This ticket is not authentic.",
            ticketId: ticketId,
            securityIssue: true
          };
        }
        
        return { 
          valid: true, 
          ticketId: ticketId,
          ticketType: ticketType,
          status: status,
          checkInTime: status === "Checked-In" ? timestamp : null,
          securityToken: scannedToken,
          eventCode: EVENT_CODE
        };
      }
    }
    
    return { valid: false, message: "Ticket not found in database" };
    
  } catch (error) {
    return { valid: false, message: "Error: " + error.toString() };
  }
}

function getTicketStats() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Ticket List");
  const data = sheet.getDataRange().getValues();
  
  const stats = {
    total: data.length - 1,
    checkedIn: 0,
    notCheckedIn: 0,
    invalid: 0,
    byType: {}
  };
  
  for (let i = 1; i < data.length; i++) {
    const ticketType = data[i][1];
    const status = data[i][5];
    
    if (!stats.byType[ticketType]) {
      stats.byType[ticketType] = { total: 0, checkedIn: 0, invalid: 0 };
    }
    
    stats.byType[ticketType].total++;
    
    if (status === "Checked-In") {
      stats.checkedIn++;
      stats.byType[ticketType].checkedIn++;
    } else if (status === "INVALID") {
      stats.invalid++;
      stats.byType[ticketType].invalid++;
    } else {
      stats.notCheckedIn++;
    }
  }
  
  Logger.log("📊 Ticket Statistics:");
  Logger.log(`   Event: ${EVENT_CODE}`);
  Logger.log(`   Total: ${stats.total}`);
  Logger.log(`   Checked In: ${stats.checkedIn}`);
  Logger.log(`   Not Checked In: ${stats.notCheckedIn}`);
  Logger.log(`   Invalid/Forged: ${stats.invalid}`);
  
  for (const type in stats.byType) {
    Logger.log(`   Type ${type}: ${stats.byType[type].total} total, ${stats.byType[type].checkedIn} checked in, ${stats.byType[type].invalid} invalid`);
  }
  
  return stats;
}

function clearAllTickets() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '⚠️ Warning',
    'This will delete ALL tickets. Are you sure?',
    ui.ButtonSet.YES_NO
  );
  
  if (response == ui.Button.YES) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Ticket List");
    
    if (sheet) {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1);
        Logger.log("✅ All tickets cleared!");
        ui.alert('✅ Success', 'All tickets have been deleted.', ui.ButtonSet.OK);
      }
    }
  }
}

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Secure Ticket Scanner')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

//downlaod QR codes

function downloadAllQRCodesAutomatically() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Ticket List");
  const properties = PropertiesService.getScriptProperties();
  
  // Check if this is a continuation or new download
  let folderId = properties.getProperty('QR_FOLDER_ID');
  let lastProcessed = parseInt(properties.getProperty('QR_LAST_PROCESSED') || '0');
  let totalDownloaded = parseInt(properties.getProperty('QR_TOTAL_DOWNLOADED') || '0');
  
  const data = sheet.getDataRange().getValues();
  const totalTickets = data.length - 1;
  
  // Create folder if this is a new download
  if (!folderId) {
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HHmmss");
    const folderName = "150 Tickets";
    const folder = DriveApp.createFolder(folderName);
    folderId = folder.getId();
    
    properties.setProperty('QR_FOLDER_ID', folderId);
    properties.setProperty('QR_FOLDER_NAME', folderName);
    
    Logger.log('==========================================');
    Logger.log('🚀 Starting NEW download of ' + totalTickets + ' QR codes...');
    Logger.log(`📁 Folder: ${folderName}`);
    Logger.log('==========================================');
  } else {
    Logger.log(`📥 Continuing download... (${lastProcessed}/${totalTickets} completed)`);
  }
  
  const folder = DriveApp.getFolderById(folderId);
  const BATCH_SIZE = 100; // Download 200 at a time
  const startRow = lastProcessed + 1;
  const endRow = Math.min(startRow + BATCH_SIZE, data.length);
  
  let successCount = 0;
  let errorCount = 0;
  
  // Download this batch
  for (let i = startRow; i < endRow; i++) {
    try {
      const ticketId = data[i][0];
      const qrUrl = data[i][4]; // Column E (index 4) = QR Code Link
      
      if (!qrUrl) {
        Logger.log(`⚠️ Skipping ${ticketId}: No QR URL found`);
        errorCount++;
        continue;
      }
      
      // Fetch the QR code image
      const response = UrlFetchApp.fetch(qrUrl);
      const blob = response.getBlob();
      
      // Save to folder with ticket ID as filename
      folder.createFile(blob.setName(ticketId + '.png'));
      successCount++;
      
      // Show progress every 50 tickets
      if (successCount % 50 === 0) {
        Logger.log(`📥 Downloaded ${lastProcessed + successCount} of ${totalTickets} QR codes...`);
      }
      
    } catch (e) {
      Logger.log(`❌ Error downloading ${data[i][0]}: ${e}`);
      errorCount++;
    }
  }
  
  // Update progress
  const newLastProcessed = lastProcessed + successCount + errorCount;
  const newTotalDownloaded = totalDownloaded + successCount;
  
  properties.setProperty('QR_LAST_PROCESSED', newLastProcessed.toString());
  properties.setProperty('QR_TOTAL_DOWNLOADED', newTotalDownloaded.toString());
  
  const isComplete = newLastProcessed >= totalTickets;
  
  if (isComplete) {
    // Download complete!
    const folderUrl = folder.getUrl();
    const folderName = properties.getProperty('QR_FOLDER_NAME');
    
    Logger.log('==========================================');
    Logger.log('✅ DOWNLOAD COMPLETE!');
    Logger.log('==========================================');
    Logger.log(`Successfully downloaded: ${newTotalDownloaded} QR codes`);
    Logger.log(`Total tickets: ${totalTickets}`);
    Logger.log(`Event: ${EVENT_CODE}`);
    Logger.log(`Folder name: ${folderName}`);
    Logger.log(`Folder URL: ${folderUrl}`);
    Logger.log('==========================================');
    
    // Clear progress tracking
    properties.deleteProperty('QR_FOLDER_ID');
    properties.deleteProperty('QR_LAST_PROCESSED');
    properties.deleteProperty('QR_TOTAL_DOWNLOADED');
    properties.deleteProperty('QR_FOLDER_NAME');
    
    // Show success dialog
    SpreadsheetApp.getUi().alert(
      '✅ All QR Codes Downloaded!',
      `Successfully saved ${newTotalDownloaded} QR codes to Google Drive!\n\n` +
      `Folder: ${folderName}\n\n` +
      `TO DOWNLOAD AS ZIP:\n` +
      `1. Click OK to open the folder\n` +
      `2. Select all files (Ctrl+A or Cmd+A)\n` +
      `3. Right-click > Download\n` +
      `4. Google Drive will create a ZIP file`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    
    // Open folder
    const htmlOutput = HtmlService.createHtmlOutput(
      `<script>window.open('${folderUrl}', '_blank'); google.script.host.close();</script>`
    );
    SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Opening folder...');
    
  } else {
    // More batches needed
    const remaining = totalTickets - newLastProcessed;
    
    Logger.log('==========================================');
    Logger.log(`✅ Batch complete! Downloaded ${successCount} in this batch.`);
    Logger.log(`📊 Progress: ${newLastProcessed}/${totalTickets} (${Math.round(newLastProcessed/totalTickets*100)}%)`);
    Logger.log(`📥 Remaining: ${remaining} QR codes`);
    Logger.log('==========================================');
    Logger.log('⚠️ Run the function again to continue downloading!');
    Logger.log('==========================================');
    
    SpreadsheetApp.getUi().alert(
      '✅ Batch Complete - Continue?',
      `Downloaded: ${successCount} QR codes in this batch\n` +
      `Total progress: ${newLastProcessed}/${totalTickets} (${Math.round(newLastProcessed/totalTickets*100)}%)\n` +
      `Remaining: ${remaining} QR codes\n\n` +
      `Click OK, then run the function again to continue.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
  
  return {
    success: true,
    downloaded: successCount,
    totalDownloaded: newTotalDownloaded,
    processed: newLastProcessed,
    total: totalTickets,
    complete: isComplete
  };
}

// Reset download progress if needed
function resetQRDownloadProgress() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty('QR_FOLDER_ID');
  properties.deleteProperty('QR_LAST_PROCESSED');
  properties.deleteProperty('QR_TOTAL_DOWNLOADED');
  properties.deleteProperty('QR_FOLDER_NAME');
  
  Logger.log('✅ Download progress reset. You can start a new download.');
  SpreadsheetApp.getUi().alert('✅ Reset Complete', 'Download progress has been reset. You can start a new download.', SpreadsheetApp.getUi().ButtonSet.OK);
}