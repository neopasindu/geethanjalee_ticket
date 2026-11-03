// Regression and unit tests for ticket management system
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Setup mock Google Apps Script environment
function createMockEnvironment() {
  const store = {
    sheets: {},
    properties: {},
    logs: []
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (algo, data, charset) => {
      const hash = crypto.createHash('sha256').update(data, 'utf8').digest();
      // Return signed 8-bit integers like Java/GAS
      const signedBytes = [];
      for (let i = 0; i < hash.length; i++) {
        let b = hash[i];
        if (b > 127) b -= 256;
        signedBytes.push(b);
      }
      return signedBytes;
    },
    getRandomUuid: () => crypto.randomUUID(),
    formatString: (format, ...args) => {
      if (format === "%04d") {
        return String(args[0]).padStart(4, '0');
      }
      return String(args[0]);
    },
    formatDate: (date, tz, format) => {
      const d = new Date(date);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  };

  const Session = {
    getScriptTimeZone: () => "UTC"
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: key => store.properties[key] || null,
      setProperty: (key, val) => { store.properties[key] = String(val); },
      deleteProperty: key => { delete store.properties[key]; }
    })
  };

  const LockService = {
    getScriptLock: () => ({
      tryLock: (timeout) => true,
      releaseLock: () => {}
    })
  };

  const Logger = {
    log: (...args) => store.logs.push(args.join(' '))
  };

  class MockSheet {
    constructor(name) {
      this.name = name;
      this.rows = [];
      this.maxRows = 1000;
    }
    getLastRow() {
      return this.rows.length;
    }
    getMaxRows() {
      return this.maxRows;
    }
    getDataRange() {
      return {
        getValues: () => this.rows.map(r => [...r])
      };
    }
    getRange(row, col, numRows = 1, numCols = 1) {
      if (row + numRows - 1 > this.maxRows) {
        throw new Error(`Coordinates out of bounds: row ${row} + ${numRows} > maxRows ${this.maxRows}`);
      }
      const self = this;
      return {
        getValues: () => {
          const result = [];
          for (let r = 0; r < numRows; r++) {
            const rowData = self.rows[row - 1 + r] || [];
            const slice = [];
            for (let c = 0; c < numCols; c++) {
              slice.push(rowData[col - 1 + c] !== undefined ? rowData[col - 1 + c] : '');
            }
            result.push(slice);
          }
          return result;
        },
        getValue: () => {
          const rowData = self.rows[row - 1] || [];
          return rowData[col - 1] !== undefined ? rowData[col - 1] : '';
        },
        setValues: (values) => {
          for (let r = 0; r < values.length; r++) {
            const targetRow = row - 1 + r;
            while (self.rows.length <= targetRow) {
              self.rows.push([]);
            }
            for (let c = 0; c < values[r].length; c++) {
              self.rows[targetRow][col - 1 + c] = values[r][c];
            }
          }
        },
        setValue: (val) => {
          const targetRow = row - 1;
          while (self.rows.length <= targetRow) {
            self.rows.push([]);
          }
          self.rows[targetRow][col - 1] = val;
        },
        setFontWeight: () => {},
        setBackground: () => {},
        setFontColor: () => {},
        setNumberFormat: (fmt) => {
          self.lastNumberFormat = fmt;
        }
      };
    }
    setFrozenRows() {}
    autoResizeColumns() {}
    setConditionalFormatRules() {}
    deleteRows(start, count) {
      this.rows.splice(start - 1, count);
    }
  }

  const mockSpreadsheet = {
    getSheetByName: (name) => store.sheets[name] || null,
    insertSheet: (name) => {
      const s = new MockSheet(name);
      store.sheets[name] = s;
      return s;
    }
  };

  const SpreadsheetApp = {
    openById: (id) => mockSpreadsheet,
    getActiveSpreadsheet: () => mockSpreadsheet,
    getUi: () => ({
      alert: () => {},
      showModalDialog: () => {},
      createMenu: () => ({
        addItem: function() { return this; },
        addSeparator: function() { return this; },
        addToUi: function() {}
      }),
      ButtonSet: { OK: 1, YES_NO: 2 },
      Button: { YES: 1, NO: 2 }
    }),
    newConditionalFormatRule: () => ({
      whenTextEqualTo: function() { return this; },
      setBackground: function() { return this; },
      setRanges: function() { return this; },
      build: function() { return {}; }
    })
  };

  const HtmlService = {
    createHtmlOutput: (html) => ({
      setWidth: function() { return this; },
      setHeight: function() { return this; },
      setTitle: function() { return this; },
      setXFrameOptionsMode: function() { return this; },
      addMetaTag: function() { return this; }
    }),
    createHtmlOutputFromFile: (name) => {
      const filePath = path.join(__dirname, '..', `${name}.html`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Could not find file: ${name}`);
      }
      return HtmlService.createHtmlOutput(fs.readFileSync(filePath, 'utf8'));
    },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
  };

  const ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput: (text) => ({
      setMimeType: function(mime) { this.mime = mime; return this; },
      getContent: () => text
    })
  };

  const UrlFetchApp = {
    fetch: (url) => ({
      getResponseCode: () => 200,
      getBlob: () => ({
        setName: (name) => ({ name, content: 'mock-png-data' })
      })
    }),
    fetchAll: (requests) => requests.map(r => ({
      getResponseCode: () => 200,
      getBlob: () => ({
        setName: (name) => ({ name, content: 'mock-png-data' })
      })
    }))
  };

  const DriveApp = {
    createFolder: (name) => ({
      getId: () => 'mock-folder-id',
      getUrl: () => 'https://drive.google.com/mock-folder',
      createFile: (blob) => blob
    }),
    getFolderById: (id) => ({
      getId: () => id,
      getUrl: () => 'https://drive.google.com/mock-folder',
      createFile: (blob) => blob
    })
  };

  const env = {
    Utilities,
    Session,
    PropertiesService,
    LockService,
    Logger,
    SpreadsheetApp,
    HtmlService,
    ContentService,
    UrlFetchApp,
    DriveApp,
    store,
    MockSheet
  };

  return env;
}

module.exports = { createMockEnvironment };
