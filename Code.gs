/**
 * ==============================================================================
 * 🎟️ SECURE EVENT TICKET GENERATION, VERIFICATION & MANAGEMENT SYSTEM
 * ==============================================================================
 * High-performance, cryptographically secure ticket system for Google Sheets.
 * Features:
 *   - Cryptographic SHA-256 validation tokens & anti-forgery verification
 *   - Real-time check-in engine with concurrency locking (LockService)
 *   - QuickChart QR code generation with parallel batch downloading
 *   - Web App QR scanner interface (Index.html) + REST API endpoints
 *   - SQL export tool for phpMyAdmin / MySQL hosting
 * ==============================================================================
 */

// ==============================================================================
// ⚙️ CONFIGURATION
// ==============================================================================
var CONFIG = {
  // Ticket category identifier (e.g. A, B, C, D, VIP, GA)
  TICKET_TYPE: "D",

  // Number of tickets to generate in this batch
  TICKET_QUANTITY: 2850,

  // Google Spreadsheet ID.
  // Leave empty ("") when using as a container-bound script (Extensions > Apps Script);
  // the script will automatically attach to SpreadsheetApp.getActiveSpreadsheet().
  SPREADSHEET_ID: "",

  // Unique event identifier embedded into hashes and QR code captions
  EVENT_CODE: "Geethanjalee360",

  // Secret key used to salt SHA-256 validation hashes.
  // Can also be set securely in Script Properties via key 'SECRET_KEY'.
  SECRET_KEY: "CHANGE_THIS_TO_YOUR_EVENT_SECRET_KEY",

  // Length of the cryptographically generated security token (default 8)
  TOKEN_LENGTH: 8,

  // QR Code image size in pixels
  QR_SIZE: 250,

  // Batch size for Drive QR code downloads (Google Apps Script execution limit safe)
  QR_BATCH_SIZE: 100
};

// Backwards-compatibility aliases for legacy scripts
var TICKET_TYPE = CONFIG.TICKET_TYPE;
var TICKET_QUANTITY = CONFIG.TICKET_QUANTITY;
var SPREADSHEET_ID = CONFIG.SPREADSHEET_ID;
var EVENT_CODE = CONFIG.EVENT_CODE;
var TOKEN_LENGTH = CONFIG.TOKEN_LENGTH;


// ==============================================================================
// 🛠️ HELPER FUNCTIONS
// ==============================================================================

/**
 * Resolves the active Google Spreadsheet.
 * Prefers SPREADSHEET_ID if explicitly configured; otherwise uses getActiveSpreadsheet().
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  const id = (CONFIG.SPREADSHEET_ID || "").trim();
  if (id && id !== "YOUR_SPREADSHEET_ID") {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      Logger.log("⚠️ Could not open sheet by ID (" + id + "), attempting active spreadsheet: " + e);
    }
  }

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      "No active spreadsheet found. If running as a standalone script, please set CONFIG.SPREADSHEET_ID."
    );
  }
  return active;
}

/**
 * Safely display an alert dialog if UI context is available; logs otherwise.
 */
function showAlert(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(`[ALERT] ${title}: ${message}`);
  }
}

/**
 * Returns the configured secret key, preferring Script Properties over CONFIG constant.
 * @returns {string}
 */
function getSecretKey() {
  try {
    const prop = PropertiesService.getScriptProperties().getProperty('SECRET_KEY');
    if (prop && prop.trim().length > 0) {
      return prop.trim();
    }
  } catch (e) {
    // Ignore properties service error in offline/test context
  }
  return CONFIG.SECRET_KEY || "DEFAULT_GEETHANJALEE_SECRET_KEY";
}

// ==============================================================================
// 🔐 CRYPTOGRAPHIC SECURITY FUNCTIONS
// ==============================================================================

/**
 * Generates a cryptographically strong random token using high-entropy UUID + SHA-256 digest.
 * Base32 unambiguous character set excludes easily confused characters (0, 1, I, O).
 * Zero modulo bias is guaranteed because 256 is an exact multiple of 32 (256 / 32 = 8).
 *
 * @param {number} length Desired token length (default 8)
 * @returns {string} Secure uppercase alphanumeric token
 */
function generateSecureToken(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters
  let token = '';

  let bytes = [];
  try {
    // Gather high-entropy seed from Java SecureRandom UUID + high-res time + Math.random
    while (bytes.length < length) {
      const seed = Utilities.getRandomUuid() + '-' + Date.now() + '-' + Math.random() + '-' + bytes.length;
      const digest = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        seed,
        Utilities.Charset.UTF_8
      );
      bytes = bytes.concat(digest);
    }
  } catch (e) {
    // Fallback if Utilities is unavailable
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * chars.length);
      token += chars.charAt(randomIndex);
    }
    return token;
  }

  for (let i = 0; i < length; i++) {
    const byteVal = (bytes[i] + 256) % 256;
    token += chars.charAt(byteVal & 31); // 0-31 uniform mapping
  }

  return token;
}

/**
 * Computes an HMAC-like SHA-256 validation signature for a ticket and token.
 * Prevents ticket forgery and unauthorized generation.
 *
 * @param {string} ticketId Full ticket identifier (e.g. TICKET-D-0001)
 * @param {string} token Security token associated with the ticket
 * @returns {string} 8-character uppercase hexadecimal signature
 */
function generateValidationHash(ticketId, token) {
  const secret = getSecretKey();
  const dataToHash = String(ticketId).trim() + String(token).trim() + secret + CONFIG.EVENT_CODE;

  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    dataToHash,
    Utilities.Charset.UTF_8
  );

  let hashHex = '';
  // Use first 4 bytes = 8 hex chars for compact, high-entropy signature
  for (let i = 0; i < 4; i++) {
    const byte = hash[i];
    const hex = (byte < 0 ? byte + 256 : byte).toString(16);
    hashHex += hex.length === 1 ? '0' + hex : hex;
  }

  return hashHex.toUpperCase();
}

// ==============================================================================
// 📋 SHEET INITIALIZATION & SETUP
// ==============================================================================

/**
 * Sets up the 'Ticket List' sheet with proper headers, formatting, and constraints.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function setupSheet() {
  const ss = getSpreadsheet();
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

  // Ensure Column D (Validation Hash) is formatted as plain text '@' without bounds errors
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) {
    sheet.getRange(2, 4, maxRows - 1, 1).setNumberFormat('@');
  }

  Logger.log("✅ Sheet is ready!");
  return sheet;
}

// ==============================================================================
// 🎫 TICKET GENERATION ENGINE
// ==============================================================================

/**
 * Generates a batch of secure tickets with cryptographic tokens, hashes, and QR links.
 */
function generateQRCodes() {
  try {
    const sheet = setupSheet();
    const lastRow = sheet.getLastRow();
    const startRow = lastRow + 1;

    // Scan existing rows to find the true highest ticket number for this TICKET_TYPE
    let lastTicketNumber = 0;
    if (lastRow > 1) {
      const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const prefix = `TICKET-${CONFIG.TICKET_TYPE}-`;
      for (let r = 0; r < idValues.length; r++) {
        const val = String(idValues[r][0]).trim();
        if (val.startsWith(prefix)) {
          const num = parseInt(val.substring(prefix.length), 10);
          if (!isNaN(num) && num > lastTicketNumber) {
            lastTicketNumber = num;
          }
        }
      }
    }

    Logger.log(`📝 Starting secure ticket generation...`);
    Logger.log(`   Event Code: ${CONFIG.EVENT_CODE}`);
    Logger.log(`   Type: ${CONFIG.TICKET_TYPE}`);
    Logger.log(`   Quantity: ${CONFIG.TICKET_QUANTITY}`);
    Logger.log(`   Starting from row: ${startRow}`);
    Logger.log(`   Starting ticket number: ${lastTicketNumber + 1}`);
    Logger.log(`   Security: ${CONFIG.TOKEN_LENGTH}-character token + validation hash`);

    const batchData = [];
    const usedTokens = new Set();

    for (let i = 0; i < CONFIG.TICKET_QUANTITY; i++) {
      const ticketNumber = lastTicketNumber + i + 1;
      const ticketId = `TICKET-${CONFIG.TICKET_TYPE}-${Utilities.formatString("%04d", ticketNumber)}`;

      let securityToken;
      do {
        securityToken = generateSecureToken(CONFIG.TOKEN_LENGTH);
      } while (usedTokens.has(securityToken));
      usedTokens.add(securityToken);

      const validationHash = generateValidationHash(ticketId, securityToken);

      // Force plain text storage in sheets by prepending apostrophe
      const validationHashText = "'" + validationHash;

      // Scanned payload: TICKET-{TYPE}-{NUM}-{TOKEN}
      const fullTicketCode = `${ticketId}-${securityToken}`;
      const qrData = encodeURIComponent(fullTicketCode);

      // Caption safely URI encoded
      const caption = encodeURIComponent(`TYPE ${CONFIG.TICKET_TYPE} | ${CONFIG.EVENT_CODE}`);
      const qrUrl = `https://quickchart.io/qr?text=${qrData}&size=${CONFIG.QR_SIZE}&caption=${caption}&captionFontSize=16`;

      const timestamp = new Date();

      batchData.push([
        ticketId,
        CONFIG.TICKET_TYPE,
        securityToken,
        validationHashText,
        qrUrl,
        "Not Checked-In",
        timestamp
      ]);

      if ((i + 1) % 500 === 0 || (i + 1) === CONFIG.TICKET_QUANTITY) {
        Logger.log(`   Generated ${i + 1}/${CONFIG.TICKET_QUANTITY} tickets in memory...`);
      }
    }

    // Write all rows in a single batch call
    if (batchData.length > 0) {
      sheet.getRange(startRow, 1, batchData.length, 7).setValues(batchData);
    }

    sheet.autoResizeColumns(1, 7);

    // Apply conditional formatting rules for visual check-in statuses
    try {
      const totalRows = sheet.getLastRow();
      if (totalRows > 1) {
        const statusRange = sheet.getRange(2, 6, totalRows - 1, 1);
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
      }
    } catch (e) {
      Logger.log("⚠️ Conditional formatting rule setup note: " + e);
    }

    Logger.log(`✅ Successfully generated ${batchData.length} secure tickets of Type ${CONFIG.TICKET_TYPE}!`);
    Logger.log(`   First ticket: ${batchData[0][0]}-${batchData[0][2]}`);
    Logger.log(`   Last ticket: ${batchData[batchData.length - 1][0]}-${batchData[batchData.length - 1][2]}`);

    showAlert(
      '✅ Success!',
      `Generated ${batchData.length} SECURE tickets of Type ${CONFIG.TICKET_TYPE}\n\n` +
      `Event: ${CONFIG.EVENT_CODE}\n` +
      `First: ${batchData[0][0]}-${batchData[0][2]}\n` +
      `Last: ${batchData[batchData.length - 1][0]}-${batchData[batchData.length - 1][2]}\n\n` +
      `🔒 SECURITY FEATURES:\n` +
      `• Each ticket has a unique ${CONFIG.TOKEN_LENGTH}-character security token\n` +
      `• SHA-256 validation hash prevents forgery\n` +
      `• Event code embedded: ${CONFIG.EVENT_CODE}\n` +
      `• QuickChart QR codes ready for batch download`
    );

  } catch (error) {
    Logger.log("❌ Error generating tickets: " + error.toString());
    showAlert('❌ Error', 'Failed to generate tickets: ' + error.toString());
  }
}

// ==============================================================================
// 🔍 CHECK-IN & VERIFICATION ENGINE (ATOMIC & CONCURRENCY SAFE)
// ==============================================================================

/**
 * Checks in a ticket by validating its token, recalculating the SHA-256 signature,
 * and atomically updating the sheet with concurrency locking.
 *
 * @param {string} scannedCode Scanned QR code text (e.g. TICKET-D-0001-A2B3C4D5)
 * @returns {object} { success: boolean, message: string, ticketId?: string, ticketType?: string, securityToken?: string }
 */
function checkInTicket(scannedCode) {
  // Use script lock to prevent race conditions during concurrent door scans
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(10000);
  if (!hasLock) {
    return { success: false, message: "⚠️ Scanner busy with another check-in. Please scan again." };
  }

  try {
    if (!scannedCode || typeof scannedCode !== 'string') {
      return { success: false, message: "❌ Invalid ticket format: Empty code!" };
    }

    const cleanedCode = scannedCode.trim();
    const lastHyphen = cleanedCode.lastIndexOf('-');
    if (lastHyphen === -1) {
      return { success: false, message: "❌ Invalid ticket format: Missing token separator!" };
    }

    const ticketId = cleanedCode.substring(0, lastHyphen).trim();
    const scannedToken = cleanedCode.substring(lastHyphen + 1).trim().toUpperCase();

    if (!ticketId || !scannedToken) {
      return { success: false, message: "❌ Invalid ticket format: Incomplete ticket data!" };
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName("Ticket List");
    if (!sheet) {
      return { success: false, message: "❌ Database sheet 'Ticket List' not found!" };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === ticketId) {
        const storedToken = String(data[i][2]).trim().toUpperCase();
        // Strip any leading apostrophe and whitespace from stored validation hash
        const validationHash = String(data[i][3]).replace(/^'/, '').trim().toUpperCase();
        const status = data[i][5];
        const ticketType = data[i][1];

        // 1. Verify token match
        if (storedToken !== scannedToken) {
          sheet.getRange(i + 1, 6).setValue("INVALID");
          return {
            success: false,
            message: "🚨 SECURITY ALERT: Token mismatch! This ticket may be forged.",
            ticketId: ticketId
          };
        }

        // 2. Cryptographic signature check
        const computedHash = generateValidationHash(ticketId, scannedToken).toUpperCase();
        if (computedHash !== validationHash) {
          sheet.getRange(i + 1, 6).setValue("INVALID");
          return {
            success: false,
            message: "🚨 SECURITY ALERT: Invalid signature! This ticket is not authentic.",
            ticketId: ticketId
          };
        }

        // 3. Double check-in prevention
        if (status === "Checked-In") {
          return {
            success: false,
            alreadyCheckedIn: true,
            message: `⚠️ Ticket already checked in at: ${data[i][6]}`,
            ticketId: ticketId,
            ticketType: ticketType,
            timestamp: data[i][6]
          };
        }

        // 4. Atomic status & timestamp update in a single range call
        const checkinTime = new Date();
        sheet.getRange(i + 1, 6, 1, 2).setValues([["Checked-In", checkinTime]]);

        return {
          success: true,
          message: `✅ Valid ticket! ${ticketId} (Type ${ticketType}) checked in successfully!`,
          ticketId: ticketId,
          ticketType: ticketType,
          securityToken: scannedToken,
          timestamp: checkinTime
        };
      }
    }

    return { success: false, message: "❌ Ticket not found in database!" };

  } catch (error) {
    return { success: false, message: "❌ Error during check-in: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Verifies a ticket's validity and status without modifying the spreadsheet.
 *
 * @param {string} scannedCode Scanned QR code text
 * @returns {object} Status object
 */
function verifyTicket(scannedCode) {
  try {
    if (!scannedCode || typeof scannedCode !== 'string') {
      return { valid: false, message: "Invalid ticket input" };
    }

    const cleanedCode = scannedCode.trim();
    const lastHyphen = cleanedCode.lastIndexOf('-');
    if (lastHyphen === -1) {
      return { valid: false, message: "Invalid ticket format: missing token" };
    }

    const ticketId = cleanedCode.substring(0, lastHyphen).trim();
    const scannedToken = cleanedCode.substring(lastHyphen + 1).trim().toUpperCase();

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName("Ticket List");
    if (!sheet) {
      return { valid: false, message: "Database not found" };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === ticketId) {
        const storedToken = String(data[i][2]).trim().toUpperCase();
        // Strip leading apostrophe and whitespace
        const validationHash = String(data[i][3]).replace(/^'/, '').trim().toUpperCase();
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

        const computedHash = generateValidationHash(ticketId, scannedToken).toUpperCase();
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
          eventCode: CONFIG.EVENT_CODE
        };
      }
    }

    return { valid: false, message: "Ticket not found in database" };

  } catch (error) {
    return { valid: false, message: "Error: " + error.toString() };
  }
}

/**
 * Aggregates statistics for the event ticket database.
 * @returns {object} Ticket statistics breakdown
 */
function getTicketStats() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Ticket List");
  if (!sheet) {
    return { total: 0, checkedIn: 0, notCheckedIn: 0, invalid: 0, byType: {} };
  }

  const data = sheet.getDataRange().getValues();

  const stats = {
    eventCode: CONFIG.EVENT_CODE,
    total: Math.max(0, data.length - 1),
    checkedIn: 0,
    notCheckedIn: 0,
    invalid: 0,
    byType: {}
  };

  for (let i = 1; i < data.length; i++) {
    const ticketType = String(data[i][1] || 'Unknown');
    const status = String(data[i][5] || 'Not Checked-In');

    if (!stats.byType[ticketType]) {
      stats.byType[ticketType] = { total: 0, checkedIn: 0, notCheckedIn: 0, invalid: 0 };
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
      stats.byType[ticketType].notCheckedIn++;
    }
  }

  Logger.log("📊 Ticket Statistics:");
  Logger.log(`   Event: ${CONFIG.EVENT_CODE}`);
  Logger.log(`   Total: ${stats.total}`);
  Logger.log(`   Checked In: ${stats.checkedIn}`);
  Logger.log(`   Not Checked In: ${stats.notCheckedIn}`);
  Logger.log(`   Invalid/Forged: ${stats.invalid}`);

  return stats;
}

/**
 * Clears all generated tickets from the sheet after user confirmation.
 */
function clearAllTickets() {
  try {
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert(
      '⚠️ Warning',
      'This will delete ALL tickets and check-in records. Are you sure?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      return;
    }
  } catch (e) {
    // If running without UI context, proceed
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Ticket List");

  if (sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
      Logger.log("✅ All tickets cleared!");
      showAlert('✅ Success', 'All tickets have been deleted.');
    }
  }
}

// ==============================================================================
// 📥 BATCH QR CODE DOWNLOADER
// ==============================================================================

/**
 * Downloads generated QR code images to Google Drive in managed batches
 * using parallel HTTP requests (UrlFetchApp.fetchAll) to safely avoid Apps Script timeout limits.
 */
function downloadAllQRCodesAutomatically() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Ticket List");
  if (!sheet) {
    showAlert('❌ Error', "Could not find 'Ticket List' sheet.");
    return { success: false, message: "Sheet not found" };
  }

  const properties = PropertiesService.getScriptProperties();

  let folderId = properties.getProperty('QR_FOLDER_ID');
  let lastProcessed = parseInt(properties.getProperty('QR_LAST_PROCESSED') || '0', 10);
  let totalDownloaded = parseInt(properties.getProperty('QR_TOTAL_DOWNLOADED') || '0', 10);

  const data = sheet.getDataRange().getValues();
  const totalTickets = data.length - 1;

  if (totalTickets <= 0) {
    showAlert('ℹ️ Notice', "No tickets found to download.");
    return { success: false, message: "No tickets" };
  }

  // Create destination folder on first run
  if (!folderId) {
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HHmmss");
    const folderName = `${CONFIG.EVENT_CODE}_Tickets_${CONFIG.TICKET_TYPE}_${timestamp}`;
    const folder = DriveApp.createFolder(folderName);
    folderId = folder.getId();

    properties.setProperty('QR_FOLDER_ID', folderId);
    properties.setProperty('QR_FOLDER_NAME', folderName);

    Logger.log('==========================================');
    Logger.log(`🚀 Starting NEW download of ${totalTickets} QR codes...`);
    Logger.log(`📁 Folder: ${folderName}`);
    Logger.log('==========================================');
  } else {
    Logger.log(`📥 Continuing download... (${lastProcessed}/${totalTickets} completed)`);
  }

  const folder = DriveApp.getFolderById(folderId);
  const BATCH_SIZE = CONFIG.QR_BATCH_SIZE || 100;
  const startRow = lastProcessed + 1;
  const endRow = Math.min(startRow + BATCH_SIZE, data.length);

  let successCount = 0;
  let errorCount = 0;

  // Process batch in fast parallel sub-batches of 20
  const subBatchSize = 20;
  for (let chunkStart = startRow; chunkStart < endRow; chunkStart += subBatchSize) {
    const chunkEnd = Math.min(chunkStart + subBatchSize, endRow);
    const requests = [];
    const chunkTickets = [];

    for (let i = chunkStart; i < chunkEnd; i++) {
      const ticketId = data[i][0];
      const qrUrl = data[i][4];

      if (!qrUrl) {
        Logger.log(`⚠️ Skipping ${ticketId}: No QR URL found`);
        errorCount++;
        continue;
      }

      requests.push({ url: qrUrl, muteHttpExceptions: true });
      chunkTickets.push({ ticketId: ticketId, url: qrUrl });
    }

    if (requests.length > 0) {
      try {
        const responses = UrlFetchApp.fetchAll(requests);
        for (let r = 0; r < responses.length; r++) {
          const resp = responses[r];
          if (resp.getResponseCode() === 200) {
            folder.createFile(resp.getBlob().setName(chunkTickets[r].ticketId + '.png'));
            successCount++;
          } else {
            Logger.log(`❌ HTTP ${resp.getResponseCode()} downloading ${chunkTickets[r].ticketId}`);
            errorCount++;
          }
        }
      } catch (batchErr) {
        // Fallback to sequential fetch on network or library error
        Logger.log(`⚠️ Batch fetch error: ${batchErr}. Falling back to individual fetches.`);
        for (let r = 0; r < chunkTickets.length; r++) {
          try {
            const resp = UrlFetchApp.fetch(chunkTickets[r].url, { muteHttpExceptions: true });
            if (resp.getResponseCode() === 200) {
              folder.createFile(resp.getBlob().setName(chunkTickets[r].ticketId + '.png'));
              successCount++;
            } else {
              errorCount++;
            }
          } catch (e) {
            Logger.log(`❌ Error downloading ${chunkTickets[r].ticketId}: ${e}`);
            errorCount++;
          }
        }
      }
    }
  }

  const newLastProcessed = lastProcessed + successCount + errorCount;
  const newTotalDownloaded = totalDownloaded + successCount;

  properties.setProperty('QR_LAST_PROCESSED', newLastProcessed.toString());
  properties.setProperty('QR_TOTAL_DOWNLOADED', newTotalDownloaded.toString());

  const isComplete = newLastProcessed >= totalTickets;

  if (isComplete) {
    const folderUrl = folder.getUrl();
    const folderName = properties.getProperty('QR_FOLDER_NAME');

    Logger.log('==========================================');
    Logger.log('✅ DOWNLOAD COMPLETE!');
    Logger.log(`Downloaded: ${newTotalDownloaded}/${totalTickets} QR codes`);
    Logger.log(`Folder: ${folderName}`);
    Logger.log(`URL: ${folderUrl}`);
    Logger.log('==========================================');

    properties.deleteProperty('QR_FOLDER_ID');
    properties.deleteProperty('QR_LAST_PROCESSED');
    properties.deleteProperty('QR_TOTAL_DOWNLOADED');
    properties.deleteProperty('QR_FOLDER_NAME');

    showAlert(
      '✅ All QR Codes Downloaded!',
      `Successfully saved ${newTotalDownloaded} QR codes to Google Drive!\n\n` +
      `Folder: ${folderName}\n\n` +
      `Download as ZIP:\n` +
      `1. Open Google Drive folder\n` +
      `2. Select all files (Ctrl+A)\n` +
      `3. Right-click > Download`
    );

  } else {
    const remaining = totalTickets - newLastProcessed;
    Logger.log(`✅ Batch complete: ${successCount} downloaded. Remaining: ${remaining}`);

    showAlert(
      '✅ Batch Complete - Continue?',
      `Downloaded: ${successCount} QR codes in this batch\n` +
      `Progress: ${newLastProcessed}/${totalTickets} (${Math.round((newLastProcessed / totalTickets) * 100)}%)\n` +
      `Remaining: ${remaining} QR codes\n\n` +
      `Run downloadAllQRCodesAutomatically() again to continue.`
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

/**
 * Resets download tracking properties so a new download session can start.
 */
function resetQRDownloadProgress() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty('QR_FOLDER_ID');
  properties.deleteProperty('QR_LAST_PROCESSED');
  properties.deleteProperty('QR_TOTAL_DOWNLOADED');
  properties.deleteProperty('QR_FOLDER_NAME');

  Logger.log('✅ Download progress reset.');
  showAlert('✅ Reset Complete', 'Download progress has been reset. You can start a new download.');
}

// ==============================================================================
// 🌐 WEB APP & REST API HANDLERS (doGet)
// ==============================================================================

/**
 * Serves the mobile/desktop QR code scanner Web App, or handles JSON API requests.
 *
 * Query parameters:
 *   ?action=checkin&code=TICKET-D-0001-A2B3C4D5
 *   ?action=verify&code=TICKET-D-0001-A2B3C4D5
 *   ?action=stats
 */
function doGet(e) {
  // If request contains API action query parameter, return JSON response
  if (e && e.parameter && e.parameter.action) {
    return handleApiRequest(e.parameter);
  }

  // Otherwise serve the HTML scanner interface
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle(`Secure Ticket Scanner - ${CONFIG.EVENT_CODE}`)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      `<h2>Secure Ticket Scanner</h2><p>Scanner UI template not found.</p><pre>${err.message}</pre>`
    );
  }
}

/**
 * Handles REST API queries when doGet is invoked with parameters.
 */
function handleApiRequest(params) {
  const action = (params.action || '').toLowerCase().trim();
  let result = { success: false, message: 'Invalid action parameter' };

  if (action === 'checkin') {
    result = checkInTicket(params.code || '');
  } else if (action === 'verify') {
    result = verifyTicket(params.code || '');
  } else if (action === 'stats') {
    result = { success: true, stats: getTicketStats() };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==============================================================================
// 📋 UI MENU & DIALOGS
// ==============================================================================

/**
 * Installs custom spreadsheet menu for easy event management.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🎟️ Ticket System')
      .addItem('🎫 Generate Tickets', 'generateQRCodes')
      .addItem('📊 View Ticket Statistics', 'showStatsDialog')
      .addSeparator()
      .addItem('📥 Download QR Codes (Batch)', 'downloadAllQRCodesAutomatically')
      .addItem('🔄 Reset QR Download Progress', 'resetQRDownloadProgress')
      .addSeparator()
      .addItem('🗄️ Export to SQL File', 'exportToSQLFile')
      .addSeparator()
      .addItem('🗑️ Clear All Tickets', 'clearAllTickets')
      .addToUi();
  } catch (e) {
    Logger.log("Menu creation skipped: " + e);
  }
}

/**
 * Displays an overview dialog with current ticket counts.
 */
function showStatsDialog() {
  const stats = getTicketStats();
  let breakdown = '';
  for (const t in stats.byType) {
    const item = stats.byType[t];
    breakdown += `• Type ${t}: ${item.total} total (${item.checkedIn} checked-in, ${item.invalid} invalid)\n`;
  }

  showAlert(
    '📊 Ticket Statistics',
    `Event Code: ${stats.eventCode}\n` +
    `Total Tickets: ${stats.total}\n` +
    `Checked-In: ${stats.checkedIn}\n` +
    `Not Checked-In: ${stats.notCheckedIn}\n` +
    `Invalid / Flagged: ${stats.invalid}\n\n` +
    `Type Breakdown:\n${breakdown || 'None'}`
  );
}
