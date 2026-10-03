'use strict';
// 共用工具函式
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const TOKEN_KEY = 'isms-admin-token';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function adminToken(v) {
  try {
    if (v === null) sessionStorage.removeItem(TOKEN_KEY);
    else if (v !== undefined) sessionStorage.setItem(TOKEN_KEY, v);
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

/** 呼叫 Google Apps Script 後端。使用 text/plain 送出 JSON，避免跨網域預檢（CORS preflight）。 */
async function api(action, payload = {}) {
  const url = (window.ISMS_CONFIG && window.ISMS_CONFIG.API_URL || '').trim();
  if (!url) throw new Error('網站尚未設定後端網址：請將 Apps Script 網頁應用程式網址填入 docs/js/config.js（請參考 README 說明）。');
  const body = { action, ...payload };
  const token = adminToken();
  if (token) body.token = token;
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
  } catch (e) {
    throw new Error('無法連線至後端。請確認網路正常，且 Apps Script 已部署為「網頁應用程式」、存取權設為「所有人」。');
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`後端回應格式錯誤（${res.status}）。請確認 config.js 的網址是以 /exec 結尾的網頁應用程式網址。`);
  }
  if (!data.ok) {
    const err = new Error(data.error || '發生錯誤');
    err.code = data.code;
    throw err;
  }
  return data.data;
}

function toast(msg, isError) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isError ? 4500 : 2500);
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('zh-TW', { hour12: false });
}

const TYPE_LABEL = { single: '單選', multiple: '複選', tf: '是非' };
const OPT_LETTER = (i) => String.fromCharCode(65 + i);

function applySiteInfo(info) {
  if (!info || !info.siteName) return;
  $$('[data-site-name]').forEach((el) => { el.textContent = info.siteName; });
  document.title = document.title.replace('ISMS 課程課後測驗', info.siteName);
}

async function loadSiteInfo() {
  try {
    const info = await api('info');
    applySiteInfo(info);
    return info;
  } catch (e) {
    return null;
  }
}

function certificateUrl(id, token) {
  return `certificate.html?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
}
