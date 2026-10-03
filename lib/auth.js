'use strict';
// 後台管理者驗證：scrypt 雜湊密碼 + 記憶體 Session（HttpOnly Cookie）+ 登入失敗節流
const crypto = require('crypto');

const COOKIE = 'isms_admin';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 小時
const sessions = new Map();
const failures = new Map(); // ip -> { count, until }

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function createSession(res, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function isAuthed(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const s = token && sessions.get(token);
  if (!s) return false;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  s.expires = Date.now() + SESSION_TTL_MS; // 滑動延長
  return true;
}

function requireAdmin(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: '請先登入後台' });
}

function loginBlocked(ip) {
  const f = failures.get(ip);
  return f && f.until > Date.now();
}

function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) {
    f.until = Date.now() + 15 * 60 * 1000; // 連續 5 次失敗鎖定 15 分鐘
    f.count = 0;
  }
  failures.set(ip, f);
}

function clearFailures(ip) {
  failures.delete(ip);
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, isAuthed, requireAdmin,
  loginBlocked, recordFailure, clearFailures,
};
