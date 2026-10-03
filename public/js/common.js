'use strict';
// 共用工具函式
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch (e) { /* 非 JSON 回應 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `發生錯誤（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
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
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('zh-TW', { hour12: false });
}

const TYPE_LABEL = { single: '單選', multiple: '複選', tf: '是非' };
const OPT_LETTER = (i) => String.fromCharCode(65 + i);

async function loadSiteInfo() {
  try {
    const info = await api('/api/public/info');
    $$('[data-site-name]').forEach((el) => { el.textContent = info.siteName; });
    if (info.siteName) document.title = document.title.replace('ISMS 課程課後測驗', info.siteName);
    return info;
  } catch (e) {
    return null;
  }
}
