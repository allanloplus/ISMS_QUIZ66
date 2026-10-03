'use strict';
// 簡易 JSON 檔案資料庫：單一檔案、原子寫入（先寫暫存檔再 rename），適合中小型課程測驗使用量。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSeed } = require('./seed');

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      this.db = buildSeed();
      this.saveSync();
    }
    this.migrate();
  }

  migrate() {
    const d = this.db;
    d.settings = d.settings || {};
    d.categories = d.categories || [];
    d.courses = d.courses || [];
    d.attempts = d.attempts || [];
    d.counters = d.counters || {};
  }

  saveSync() {
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  save() {
    // 同步寫入即可避免併發覆寫問題（Node 單執行緒）
    this.saveSync();
  }

  static id() {
    return crypto.randomUUID();
  }

  nextCertNo(prefix, date) {
    const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
    const key = 'cert-' + ymd;
    this.db.counters[key] = (this.db.counters[key] || 0) + 1;
    return `${prefix}-${ymd}-${String(this.db.counters[key]).padStart(4, '0')}`;
  }
}

module.exports = { Store };
