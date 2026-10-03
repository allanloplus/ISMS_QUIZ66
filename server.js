'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Store } = require('./lib/store');
const auth = require('./lib/auth');
const { normalizeQuestion, publicQuiz, grade, totalPoints, str } = require('./lib/quiz');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createApp({ dataDir = path.join(__dirname, 'data'), adminPassword = process.env.ADMIN_PASSWORD } = {}) {
  const store = new Store(dataDir);
  const db = () => store.db;

  // 首次啟動設定管理者密碼（環境變數 ADMIN_PASSWORD，未設定則為 admin1234 並提示變更）
  if (!db().settings.adminPasswordHash) {
    db().settings.adminPasswordHash = auth.hashPassword(adminPassword || 'admin1234');
    db().settings.mustChangePassword = !adminPassword;
    store.save();
  }

  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
    next();
  });

  const categoryName = (id) => (db().categories.find((c) => c.id === id) || {}).name || '未分類';
  const findCourse = (id) => db().courses.find((c) => c.id === id);
  const courseSummary = (c) => ({
    id: c.id, categoryId: c.categoryId, categoryName: categoryName(c.categoryId), name: c.name, date: c.date,
    instructor: c.instructor, mode: c.mode, hours: c.hours, description: c.description, materialUrl: c.materialUrl,
    passScore: c.passScore, published: c.published, questionCount: c.questions.length, totalPoints: totalPoints(c.questions),
    updatedAt: c.updatedAt,
  });
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

  // ---------------- 前台 API ----------------
  app.get('/api/public/info', (req, res) => {
    const s = db().settings;
    res.json({ siteName: s.siteName, issuer: s.issuer, privacyNotice: s.privacyNotice, categories: db().categories });
  });

  app.get('/api/public/courses', (req, res) => {
    res.json(db().courses.filter((c) => c.published && c.questions.length > 0).map(courseSummary)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')));
  });

  app.get('/api/public/courses/:id/quiz', (req, res) => {
    const c = findCourse(req.params.id);
    if (!c || !c.published || c.questions.length === 0) return bad(res, '找不到此課程或尚未開放測驗', 404);
    res.json({ course: courseSummary(c), questions: publicQuiz(c) });
  });

  // 簡易送出頻率限制，避免濫用
  const submitHits = new Map();
  function submitLimited(ip) {
    const now = Date.now();
    const hits = (submitHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    hits.push(now);
    submitHits.set(ip, hits);
    return hits.length > 30;
  }

  app.post('/api/public/courses/:id/submit', (req, res) => {
    const c = findCourse(req.params.id);
    if (!c || !c.published || c.questions.length === 0) return bad(res, '找不到此課程或尚未開放測驗', 404);
    if (submitLimited(req.ip)) return bad(res, '送出次數過於頻繁，請稍後再試', 429);

    const p = req.body.participant || {};
    const participant = {
      company: str(p.company, 200), dept: str(p.dept, 200), name: str(p.name, 100),
      title: str(p.title, 100), email: str(p.email, 200).toLowerCase(),
    };
    const labels = { company: '公司名稱', dept: '單位', name: '姓名', title: '職稱', email: 'E-mail' };
    for (const k of Object.keys(labels)) if (!participant[k]) return bad(res, `請填寫${labels[k]}`);
    if (!EMAIL_RE.test(participant.email)) return bad(res, 'E-mail 格式不正確');
    if (!req.body.consent) return bad(res, '請先閱讀並同意個人資料蒐集告知事項');

    const result = grade(c.questions, req.body.answers);
    const passed = result.score >= Number(c.passScore);
    const now = new Date();
    const startedAt = Date.parse(req.body.startedAt);
    const attempt = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('hex'),
      courseId: c.id,
      course: { name: c.name, categoryName: categoryName(c.categoryId), date: c.date, instructor: c.instructor, mode: c.mode, hours: c.hours },
      participant,
      score: result.score,
      total: result.total,
      passScore: c.passScore,
      passed,
      correctCount: result.correctCount,
      questionCount: result.questionCount,
      answers: Object.fromEntries(result.detail.map((d) => [d.id, d.given])),
      // 保存作答當下的題目快照，題庫日後修改也不影響已發出的證書內容
      questions: c.questions,
      certNo: passed ? store.nextCertNo(db().settings.certPrefix || 'ISMS', now) : null,
      durationSec: Number.isFinite(startedAt) ? Math.max(0, Math.round((now - startedAt) / 1000)) : null,
      createdAt: now.toISOString(),
    };
    db().attempts.push(attempt);
    store.save();

    const out = {
      passed, score: result.score, total: result.total, passScore: c.passScore,
      correctCount: result.correctCount, questionCount: result.questionCount,
      materialUrl: c.materialUrl || '',
    };
    if (passed) Object.assign(out, { certNo: attempt.certNo, certificateUrl: `/certificate.html?id=${attempt.id}&t=${attempt.token}` });
    res.json(out);
  });

  function certificatePayload(a) {
    const s = db().settings;
    return {
      certNo: a.certNo, participant: a.participant, course: a.course, score: a.score, total: a.total, passScore: a.passScore,
      correctCount: a.correctCount, questionCount: a.questionCount, createdAt: a.createdAt,
      issuer: s.issuer, certTitle: s.certTitle, siteName: s.siteName,
      questions: a.questions.map((q) => ({ ...q, given: a.answers[q.id] || [] })),
    };
  }

  app.get('/api/public/certificates/:id', (req, res) => {
    const a = db().attempts.find((x) => x.id === req.params.id);
    const t = String(req.query.t || '');
    if (!a || !a.passed || t.length !== a.token.length
      || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(a.token))) return bad(res, '找不到證書或連結無效', 404);
    res.json(certificatePayload(a));
  });

  // 證書真偽查驗：僅回傳遮罩後姓名，避免個資外洩
  app.get('/api/public/verify/:certNo', (req, res) => {
    const certNo = str(req.params.certNo, 64).toUpperCase();
    const a = db().attempts.find((x) => x.passed && x.certNo && x.certNo.toUpperCase() === certNo);
    if (!a) return res.json({ valid: false });
    const n = a.participant.name;
    const masked = n.length <= 1 ? n : n.length === 2 ? n[0] + '○' : n[0] + '○'.repeat(n.length - 2) + n[n.length - 1];
    res.json({ valid: true, certNo: a.certNo, name: masked, courseName: a.course.name, courseDate: a.course.date, issuedAt: a.createdAt, score: a.score, total: a.total });
  });

  // ---------------- 後台 API ----------------
  app.post('/api/admin/login', (req, res) => {
    if (auth.loginBlocked(req.ip)) return bad(res, '登入失敗次數過多，請 15 分鐘後再試', 429);
    if (!auth.verifyPassword(req.body.password || '', db().settings.adminPasswordHash)) {
      auth.recordFailure(req.ip);
      return bad(res, '密碼錯誤', 401);
    }
    auth.clearFailures(req.ip);
    auth.createSession(res, req.secure);
    res.json({ ok: true, mustChangePassword: !!db().settings.mustChangePassword });
  });

  app.post('/api/admin/logout', (req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true });
  });

  app.get('/api/admin/me', (req, res) => {
    res.json({ authed: auth.isAuthed(req), mustChangePassword: !!db().settings.mustChangePassword });
  });

  const admin = express.Router();
  admin.use(auth.requireAdmin);

  admin.post('/password', (req, res) => {
    const { current, next } = req.body;
    if (!auth.verifyPassword(current || '', db().settings.adminPasswordHash)) return bad(res, '目前密碼錯誤');
    if (!next || String(next).length < 8) return bad(res, '新密碼長度至少 8 碼');
    db().settings.adminPasswordHash = auth.hashPassword(next);
    db().settings.mustChangePassword = false;
    store.save();
    res.json({ ok: true });
  });

  admin.get('/settings', (req, res) => {
    const { adminPasswordHash, ...rest } = db().settings;
    res.json(rest);
  });

  admin.put('/settings', (req, res) => {
    const s = db().settings;
    for (const k of ['siteName', 'issuer', 'certTitle', 'defaultInstructor']) {
      if (req.body[k] !== undefined) s[k] = str(req.body[k], 200);
    }
    if (req.body.privacyNotice !== undefined) s.privacyNotice = str(req.body.privacyNotice, 5000);
    if (req.body.certPrefix !== undefined) {
      const p = str(req.body.certPrefix, 16).toUpperCase();
      if (!/^[A-Z0-9]{1,16}$/.test(p)) return bad(res, '證書字軌僅能使用英文字母與數字');
      s.certPrefix = p;
    }
    store.save();
    res.json({ ok: true });
  });

  // 課程類別
  admin.get('/categories', (req, res) => {
    res.json(db().categories.map((c) => ({ ...c, courseCount: db().courses.filter((x) => x.categoryId === c.id).length })));
  });
  admin.post('/categories', (req, res) => {
    const name = str(req.body.name, 50);
    if (!name) return bad(res, '請輸入類別名稱');
    if (db().categories.some((c) => c.name === name)) return bad(res, '類別名稱已存在');
    const cat = { id: crypto.randomUUID(), name };
    db().categories.push(cat);
    store.save();
    res.json(cat);
  });
  admin.put('/categories/:id', (req, res) => {
    const cat = db().categories.find((c) => c.id === req.params.id);
    if (!cat) return bad(res, '找不到類別', 404);
    const name = str(req.body.name, 50);
    if (!name) return bad(res, '請輸入類別名稱');
    cat.name = name;
    store.save();
    res.json(cat);
  });
  admin.delete('/categories/:id', (req, res) => {
    if (db().courses.some((c) => c.categoryId === req.params.id)) return bad(res, '此類別仍有課程，無法刪除');
    db().categories = db().categories.filter((c) => c.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });

  // 課程與題庫
  function normalizeCourse(body, existing) {
    const name = str(body.name, 200);
    if (!name) throw new Error('請輸入課程名稱');
    if (!db().categories.some((c) => c.id === body.categoryId)) throw new Error('請選擇課程類別');
    const date = str(body.date, 10);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('上課日期格式不正確');
    const questions = (Array.isArray(body.questions) ? body.questions : [])
      .map((q, i) => normalizeQuestion(q, i, () => crypto.randomUUID()));
    const passScore = Number(body.passScore);
    if (!Number.isFinite(passScore) || passScore < 0) throw new Error('及格分數需為 0 以上的數字');
    const total = totalPoints(questions);
    if (questions.length > 0 && passScore > total) throw new Error(`及格分數（${passScore}）不可高於總分（${total}）`);
    const hours = body.hours === '' || body.hours == null ? null : Number(body.hours);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) throw new Error('課程時數需為數字');
    const materialUrl = str(body.materialUrl, 1000);
    if (materialUrl && !/^https?:\/\//i.test(materialUrl)) throw new Error('教材連結需以 http:// 或 https:// 開頭');
    const now = new Date().toISOString();
    return {
      id: existing ? existing.id : crypto.randomUUID(),
      categoryId: body.categoryId,
      name,
      date,
      instructor: str(body.instructor, 100) || db().settings.defaultInstructor || '',
      mode: str(body.mode, 50),
      hours,
      description: str(body.description, 4000),
      materialUrl,
      passScore,
      shuffleQuestions: !!body.shuffleQuestions,
      shuffleOptions: !!body.shuffleOptions,
      published: !!body.published && questions.length > 0,
      questions,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
  }

  admin.get('/courses', (req, res) => {
    res.json(db().courses.map((c) => ({
      ...courseSummary(c),
      attemptCount: db().attempts.filter((a) => a.courseId === c.id).length,
      passCount: db().attempts.filter((a) => a.courseId === c.id && a.passed).length,
    })));
  });
  admin.get('/courses/:id', (req, res) => {
    const c = findCourse(req.params.id);
    if (!c) return bad(res, '找不到課程', 404);
    res.json(c);
  });
  admin.post('/courses', (req, res) => {
    try {
      const c = normalizeCourse(req.body);
      db().courses.push(c);
      store.save();
      res.json(c);
    } catch (e) { bad(res, e.message); }
  });
  admin.put('/courses/:id', (req, res) => {
    const idx = db().courses.findIndex((c) => c.id === req.params.id);
    if (idx < 0) return bad(res, '找不到課程', 404);
    try {
      const c = normalizeCourse(req.body, db().courses[idx]);
      db().courses[idx] = c;
      store.save();
      res.json(c);
    } catch (e) { bad(res, e.message); }
  });
  admin.post('/courses/:id/duplicate', (req, res) => {
    const c = findCourse(req.params.id);
    if (!c) return bad(res, '找不到課程', 404);
    const now = new Date().toISOString();
    const copy = {
      ...JSON.parse(JSON.stringify(c)), id: crypto.randomUUID(), name: c.name + '（複本）',
      published: false, createdAt: now, updatedAt: now,
    };
    copy.questions.forEach((q) => { q.id = crypto.randomUUID(); });
    db().courses.push(copy);
    store.save();
    res.json(copy);
  });
  admin.delete('/courses/:id', (req, res) => {
    db().courses = db().courses.filter((c) => c.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });

  // 測驗紀錄
  function filterAttempts(q) {
    let list = db().attempts.slice();
    if (q.courseId) list = list.filter((a) => a.courseId === q.courseId);
    if (q.status === 'passed') list = list.filter((a) => a.passed);
    if (q.status === 'failed') list = list.filter((a) => !a.passed);
    if (q.q) {
      const kw = String(q.q).toLowerCase();
      list = list.filter((a) => [a.participant.company, a.participant.dept, a.participant.name, a.participant.title,
        a.participant.email, a.certNo || ''].some((v) => v.toLowerCase().includes(kw)));
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  admin.get('/attempts', (req, res) => {
    res.json(filterAttempts(req.query).map((a) => ({
      id: a.id, courseId: a.courseId, courseName: a.course.name, participant: a.participant, score: a.score, total: a.total,
      passScore: a.passScore, passed: a.passed, certNo: a.certNo, createdAt: a.createdAt, durationSec: a.durationSec,
      certificateUrl: a.passed ? `/certificate.html?id=${a.id}&t=${a.token}` : null,
    })));
  });

  admin.get('/attempts.csv', (req, res) => {
    const esc = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 防止 CSV 公式注入
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const head = ['測驗時間', '課程名稱', '課程類別', '上課日期', '講師', '公司名稱', '單位', '姓名', '職稱', 'E-mail', '得分', '總分', '及格分數', '結果', '證書編號', '作答秒數'];
    const rows = filterAttempts(req.query).map((a) => [
      new Date(a.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }), a.course.name, a.course.categoryName,
      a.course.date, a.course.instructor, a.participant.company, a.participant.dept, a.participant.name, a.participant.title,
      a.participant.email, a.score, a.total, a.passScore, a.passed ? '通過' : '未通過', a.certNo || '', a.durationSec ?? '',
    ]);
    const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="isms-quiz-records-${Date.now()}.csv"`);
    res.send(csv);
  });

  admin.delete('/attempts/:id', (req, res) => {
    db().attempts = db().attempts.filter((a) => a.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });

  app.use('/api/admin', admin);
  app.use('/api', (req, res) => bad(res, 'Not found', 404));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    bad(res, err.type === 'entity.parse.failed' ? '資料格式錯誤' : '伺服器發生錯誤', err.status || 500);
  });

  return { app, store };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { app, store } = createApp({ dataDir: process.env.DATA_DIR || path.join(__dirname, 'data') });
  app.listen(port, () => {
    console.log(`ISMS 課程測驗網站已啟動：http://localhost:${port}`);
    console.log(`後台管理：http://localhost:${port}/admin.html`);
    if (store.db.settings.mustChangePassword) console.log('⚠ 目前使用預設管理密碼 admin1234，請登入後台立即變更。');
  });
}

module.exports = { createApp };
