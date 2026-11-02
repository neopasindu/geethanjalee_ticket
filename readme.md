# 🎟️ Secure Event Ticket Generation & Management System

A robust, secure Google Apps Script application designed to manage, generate cryptographic QR-code tickets, verify scans, check-in attendees, and export database contents directly to SQL for hosting platforms like Namecheap cPanel/phpMyAdmin.

---

## 🚀 Key Features

* **Cryptographic Security:** Utilizes unique random security tokens combined with SHA-256 validation hashes (`EVENT_CODE` + `ticketId` + `token` + `secret`) to prevent ticket forgery or tampering.
* **Automated QR Generation:** Generates customized QR code images instantly using QuickChart API, embedded with designated event branding and ticket types.
* **Batch QR Downloader:** Automates downloading all generated QR codes directly to Google Drive in manageable batches to bypass Google Apps Script execution time limits.
* **Check-In & Verification Engine:** Built-in validation functions to scan, verify authenticity, prevent double check-ins, and flag forged or mismatched credentials in real-time.
* **SQL Export Tool:** Seamlessly transforms your Google Sheets ticket repository into a clean `.sql` file structure ready for immediate database imports.

---

## ⚙️ Configuration Variables

At the top of your script file, configure your event parameters:

```javascript
const TICKET_TYPE = "D";                    // Ticket category identifier (e.g., A, B, C, D)
const TICKET_QUANTITY = 2850;               // Number of tickets to generate in a batch
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // Target Google Sheet ID
const EVENT_CODE = "Geethanjalee360";       // Unique event signature string
const TOKEN_LENGTH = 8;                     // Length of the cryptographically secure random token
```

---

## 📦 Core Functions & Usage

### 1. Ticket Generation (`generateQRCodes`)
* Sets up your `Ticket List` worksheet headers (`Ticket ID`, `Ticket Type`, `Security Token`, `Validation Hash`, `QR Code Link`, `Status`, `Timestamp`) with predefined formatting and safety constraints.
* Generates unique tokens and hashes, populating rows sequentially.
* Applies automated conditional formatting highlighting check-in statuses (`Not Checked-In`, `Checked-In`, `INVALID`).

### 2. QR Code Batch Downloader (`downloadAllQRCodesAutomatically`)
* Creates a designated folder in Google Drive to store ticket QR code images.
* Handles large quantities safely via batched execution limits.
* **Tip:** If handling massive volumes (e.g., thousands of tickets), run the script repeatedly until it reports that the download is 100% complete.

### 3. Check-In / Verification (`checkInTicket` & `verifyTicket`)
* Splits scanned QR inputs to validate tokens against stored database records.
* Automatically recalculates and compares SHA-256 signatures to detect tampering.
* Updates status strings and logs check-in timestamps seamlessly.

### 4. Database SQL Export (`exportToSQLFile`)
* Exports the Google Sheet contents into a structured modal dialog offering:
  * Direct file download (`tickets_import.sql`)
  * One-click clipboard copy
* Creates a relational table schema (`tickets`) with appropriate indexes optimized for phpMyAdmin.

---

## 🛠️ Installation & Setup

1. Open your target Google Sheet.
2. Navigate to **Extensions > Apps Script**.
3. Paste the backend script code into your project editor.
4. Replace `"YOUR_SPREADSHEET_ID"` with your actual Google Sheets file ID.
5. Save the project, reload your spreadsheet, and authorize permissions when prompted by Google Workspace.