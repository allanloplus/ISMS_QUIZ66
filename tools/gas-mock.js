'use strict';
// 以 Node.js 模擬 Google Apps Script 執行環境（試算表、屬性、快取等），供本機測試與預覽 apps-script/Code.gs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((r) => r.length !== this.nc)) throw new Error('setValues 維度不符');
    values.forEach((rowVals, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      rowVals.forEach((v, c) => {
        // 與 Google 試算表相同：開頭的單引號代表強制文字，不會存入儲存格內容
        this.sheet.data[idx][this.col - 1 + c] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
      });
    });
    return this;
  }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if ((this.data[i - 1] || []).some((v) => v !== '' && v !== undefined)) return i;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(row, col, nr = 1, nc = 1) { return new Range(this, row, col, nr, nc); }
  deleteRow(i) { this.data.splice(i - 1, 1); }
  clearContents() { this.data = []; }
  setFrozenRows() {}
}

function createGas({ codePath = path.join(__dirname, '..', 'apps-script', 'Code.gs'), timeZone = 'Asia/Taipei' } = {}) {
  const sheets = [new Sheet('工作表1')];
  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    getSheets: () => sheets.slice(),
    getSpreadsheetTimeZone: () => timeZone,
  };
  const props = new Map();
  const cache = new Map();

  const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  const fmt = (date, tz, pattern) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).map((p) => [p.type, p.value]));
    return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day);
  };

  const context = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cache.get(k); return e && e.exp > Date.now() ? e.v : null; },
        put: (k, v, ttl = 600) => { cache.set(k, { v: String(v), exp: Date.now() + ttl * 1000 }); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (value, key) => toSigned(crypto.createHmac('sha256', key).update(value).digest()),
      formatDate: fmt,
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, getContent() { return this.content; }, setMimeType() { return this; } }),
    },
    Logger: { log: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), context, { filename: 'Code.gs' });

  /** 模擬前端呼叫：送出 JSON，回傳解析後的回應 */
  function call(action, payload = {}) {
    const res = context.doPost({ postData: { contents: JSON.stringify({ action, ...payload }) } });
    return JSON.parse(res.getContent());
  }

  return { context, call, sheets, props, ss };
}

module.exports = { createGas };
