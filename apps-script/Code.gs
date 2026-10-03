/**
 * ISMS 課程課後測驗 — Google Apps Script 後端
 *
 * 使用方式（詳見 README.md）：
 * 1. 建立一份 Google 試算表 →「擴充功能」→「Apps Script」，將本檔內容全部貼上並儲存。
 * 2. 執行一次 setup()（會建立工作表、範例課程與預設管理密碼 admin1234）。
 * 3.「部署」→「新增部署作業」→ 類型「網頁應用程式」，執行身分「我」，存取權「所有人」。
 * 4. 將部署後的網址貼到 GitHub 專案 docs/js/config.js 的 API_URL。
 *
 * 資料存放於本試算表的各工作表；管理密碼雜湊與證書流水號存於「指令碼屬性」。
 */

const SHEETS = {
  settings: { name: '設定', headers: ['key', 'value'] },
  categories: { name: '課程類別', headers: ['id', 'name', 'order'] },
  courses: {
    name: '課程',
    headers: ['id', 'categoryId', 'name', 'date', 'instructor', 'mode', 'hours', 'description', 'materialUrl',
      'passScore', 'shuffleQuestions', 'shuffleOptions', 'published', 'createdAt', 'updatedAt'],
  },
  questions: {
    name: '題庫',
    headers: ['id', 'courseId', 'order', 'type', 'text', 'options', 'answer', 'points', 'explanation'],
  },
  attempts: {
    name: '測驗紀錄',
    headers: ['createdAt', 'courseName', 'categoryName', 'courseDate', 'instructor', 'company', 'dept', 'name', 'title',
      'email', 'score', 'total', 'passScore', 'passed', 'certNo', 'durationSec', 'id', 'token', 'courseId',
      'courseJSON', 'answersJSON', 'questionsJSON'],
  },
};

const SETTING_KEYS = ['siteName', 'issuer', 'certTitle', 'certPrefix', 'defaultInstructor', 'privacyNotice'];
const TYPES = ['single', 'multiple', 'tf'];
const TF_OPTIONS = ['正確', '錯誤'];
const SESSION_TTL = 6 * 60 * 60; // CacheService 上限 6 小時
const MAX_CELL = 49000; // Google 試算表單一儲存格上限 50,000 字元
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ======================= 進入點 =======================

function doGet() {
  return json_({ ok: true, data: { service: 'ISMS Quiz API', status: 'running' } });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    init_();
    const pub = PUBLIC_ACTIONS[req.action];
    const adm = ADMIN_ACTIONS[req.action];
    if (pub) out = { ok: true, data: pub(req) };
    else if (adm) {
      requireAdmin_(req.token);
      out = { ok: true, data: adm(req) };
    } else throw fail_('未知的操作：' + req.action);
  } catch (x) {
    out = { ok: false, error: x.userMessage || ('伺服器發生錯誤：' + x.message), code: x.code || 'ERR' };
  }
  return json_(out);
}

/** 首次安裝：於 Apps Script 編輯器選擇 setup 後按「執行」 */
function setup() {
  init_(true);
  Logger.log('完成：已建立工作表與範例資料。若尚未變更，管理密碼為 admin1234。');
}

/** 忘記管理密碼時：於編輯器執行此函式，密碼重設為 admin1234 */
function resetAdminPassword() {
  props_().setProperty('adminPasswordHash', hashPassword_('admin1234'));
  props_().setProperty('mustChangePassword', 'true');
  Logger.log('管理密碼已重設為 admin1234，請登入後台後立即變更。');
}

// ======================= 前台 =======================

const PUBLIC_ACTIONS = {
  info: () => publicInfo_(),

  home: () => {
    const cats = readTable_('categories');
    return {
      info: publicInfo_(),
      courses: getCourses_().filter((c) => c.published && c.questions.length > 0).map((c) => courseSummary_(c, cats))
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    };
  },

  quiz: (req) => {
    const c = openCourse_(req.courseId);
    return { info: publicInfo_(), course: courseSummary_(c), questions: publicQuiz_(c) };
  },

  submit: (req) => {
    const c = openCourse_(req.courseId);
    const p = req.participant || {};
    const participant = {
      company: str_(p.company, 200), dept: str_(p.dept, 200), name: str_(p.name, 100),
      title: str_(p.title, 100), email: str_(p.email, 200).toLowerCase(),
    };
    const labels = { company: '公司名稱', dept: '單位', name: '姓名', title: '職稱', email: 'E-mail' };
    Object.keys(labels).forEach((k) => { if (!participant[k]) throw fail_('請填寫' + labels[k]); });
    if (!EMAIL_RE.test(participant.email)) throw fail_('E-mail 格式不正確');
    if (!req.consent) throw fail_('請先閱讀並同意個人資料蒐集告知事項');

    const result = grade_(c.questions, req.answers);
    const passed = result.score >= Number(c.passScore);
    const now = new Date();
    const startedAt = Date.parse(req.startedAt);
    const cats = readTable_('categories');
    const course = {
      name: c.name, categoryName: catName_(cats, c.categoryId), date: c.date, instructor: c.instructor,
      mode: c.mode, hours: c.hours,
    };
    const attempt = {
      id: uuid_(), token: uuid_() + uuid_(), createdAt: now.toISOString(), courseId: c.id,
      courseName: course.name, categoryName: course.categoryName, courseDate: course.date, instructor: course.instructor,
      company: participant.company, dept: participant.dept, name: participant.name, title: participant.title,
      email: participant.email, score: result.score, total: result.total, passScore: Number(c.passScore), passed: passed,
      certNo: '', durationSec: isFinite(startedAt) ? Math.max(0, Math.round((now - startedAt) / 1000)) : '',
      courseJSON: JSON.stringify(course),
      answersJSON: JSON.stringify(result.detail.reduce((o, d) => { o[d.id] = d.given; return o; }, {})),
      // 保存作答當下的題目快照，題庫日後修改不影響已發出的證書
      questionsJSON: JSON.stringify(c.questions),
    };
    withLock_(() => {
      if (passed) attempt.certNo = nextCertNo_(now);
      appendRow_('attempts', attempt);
    });

    const out = {
      passed: passed, score: result.score, total: result.total, passScore: Number(c.passScore),
      correctCount: result.correctCount, questionCount: result.questionCount, materialUrl: c.materialUrl || '',
    };
    if (passed) { out.certNo = attempt.certNo; out.attemptId = attempt.id; out.token = attempt.token; }
    return out;
  },

  certificate: (req) => {
    const a = readTable_('attempts').find((x) => x.id === String(req.id || ''));
    if (!a || !bool_(a.passed) || !req.t || String(req.t) !== a.token) throw fail_('找不到證書或連結無效');
    const s = getSettings_();
    const answers = JSON.parse(a.answersJSON || '{}');
    return {
      certNo: a.certNo, createdAt: a.createdAt,
      participant: { company: a.company, dept: a.dept, name: a.name, title: a.title, email: a.email },
      course: JSON.parse(a.courseJSON || '{}'),
      score: Number(a.score), total: Number(a.total), passScore: Number(a.passScore),
      issuer: s.issuer, certTitle: s.certTitle, siteName: s.siteName,
      questions: JSON.parse(a.questionsJSON || '[]').map((q) => Object.assign({}, q, { given: answers[q.id] || [] })),
    };
  },

  // 證書查驗：僅回傳遮罩後姓名
  verify: (req) => {
    const no = str_(req.certNo, 64).toUpperCase();
    const a = no && readTable_('attempts').find((x) => bool_(x.passed) && String(x.certNo).toUpperCase() === no);
    if (!a) return { valid: false };
    const n = String(a.name);
    const masked = n.length <= 1 ? n : n.length === 2 ? n[0] + '○' : n[0] + '○'.repeat(n.length - 2) + n[n.length - 1];
    return {
      valid: true, certNo: a.certNo, name: masked, courseName: a.courseName, courseDate: a.courseDate,
      issuedAt: a.createdAt, score: Number(a.score), total: Number(a.total),
    };
  },

  login: (req) => {
    const cache = CacheService.getScriptCache();
    const fails = Number(cache.get('loginFails') || 0);
    if (fails >= 10) throw fail_('登入失敗次數過多，請 15 分鐘後再試');
    if (!verifyPassword_(String(req.password || ''), props_().getProperty('adminPasswordHash'))) {
      cache.put('loginFails', String(fails + 1), 900);
      throw fail_('密碼錯誤');
    }
    cache.remove('loginFails');
    const token = uuid_() + uuid_();
    cache.put('sess_' + token, '1', SESSION_TTL);
    return { token: token, mustChangePassword: props_().getProperty('mustChangePassword') === 'true' };
  },

  me: (req) => ({
    authed: isAdmin_(req.token),
    mustChangePassword: props_().getProperty('mustChangePassword') === 'true',
  }),
};

// ======================= 後台 =======================

const ADMIN_ACTIONS = {
  logout: (req) => { CacheService.getScriptCache().remove('sess_' + req.token); return true; },

  password: (req) => {
    if (!verifyPassword_(String(req.current || ''), props_().getProperty('adminPasswordHash'))) throw fail_('目前密碼錯誤');
    if (!req.next || String(req.next).length < 8) throw fail_('新密碼長度至少 8 碼');
    props_().setProperty('adminPasswordHash', hashPassword_(String(req.next)));
    props_().setProperty('mustChangePassword', 'false');
    return true;
  },

  getSettings: () => getSettings_(),

  saveSettings: (req) => {
    const input = req.settings || {};
    return withLock_(() => {
      const s = getSettings_();
      ['siteName', 'issuer', 'certTitle', 'defaultInstructor'].forEach((k) => {
        if (input[k] !== undefined) s[k] = str_(input[k], 200);
      });
      if (input.privacyNotice !== undefined) s.privacyNotice = str_(input.privacyNotice, 5000);
      if (input.certPrefix !== undefined) {
        const p = str_(input.certPrefix, 16).toUpperCase();
        if (!/^[A-Z0-9]{1,16}$/.test(p)) throw fail_('證書字軌僅能使用英文字母與數字');
        s.certPrefix = p;
      }
      writeTable_('settings', SETTING_KEYS.map((k) => ({ key: k, value: s[k] })));
      return true;
    });
  },

  categories: () => {
    const courses = readTable_('courses');
    return sortedCategories_().map((c) => ({
      id: c.id, name: c.name, courseCount: courses.filter((x) => x.categoryId === c.id).length,
    }));
  },

  saveCategory: (req) => withLock_(() => {
    const name = str_(req.name, 50);
    if (!name) throw fail_('請輸入類別名稱');
    const cats = sortedCategories_();
    if (cats.some((c) => c.name === name && c.id !== req.id)) throw fail_('類別名稱已存在');
    if (req.id) {
      const cat = cats.find((c) => c.id === req.id);
      if (!cat) throw fail_('找不到類別');
      cat.name = name;
    } else cats.push({ id: uuid_(), name: name });
    writeTable_('categories', cats.map((c, i) => ({ id: c.id, name: c.name, order: i + 1 })));
    return true;
  }),

  deleteCategory: (req) => withLock_(() => {
    if (readTable_('courses').some((c) => c.categoryId === req.id)) throw fail_('此類別仍有課程，無法刪除');
    writeTable_('categories', sortedCategories_().filter((c) => c.id !== req.id).map((c, i) => ({ id: c.id, name: c.name, order: i + 1 })));
    return true;
  }),

  adminCourses: () => {
    const attempts = readTable_('attempts');
    const cats = readTable_('categories');
    return getCourses_().map((c) => Object.assign(courseSummary_(c, cats), {
      attemptCount: attempts.filter((a) => a.courseId === c.id).length,
      passCount: attempts.filter((a) => a.courseId === c.id && bool_(a.passed)).length,
    }));
  },

  getCourse: (req) => {
    const c = getCourses_().find((x) => x.id === req.id);
    if (!c) throw fail_('找不到課程');
    return c;
  },

  saveCourse: (req) => withLock_(() => {
    const body = req.course || {};
    const courses = getCourses_();
    const existing = body.id ? courses.find((c) => c.id === body.id) : null;
    if (body.id && !existing) throw fail_('找不到課程');
    const c = normalizeCourse_(body, existing);
    const list = existing ? courses.map((x) => (x.id === c.id ? c : x)) : courses.concat([c]);
    saveCourses_(list);
    return c;
  }),

  duplicateCourse: (req) => withLock_(() => {
    const courses = getCourses_();
    const c = courses.find((x) => x.id === req.id);
    if (!c) throw fail_('找不到課程');
    const now = new Date().toISOString();
    const copy = Object.assign(JSON.parse(JSON.stringify(c)), {
      id: uuid_(), name: c.name + '（複本）', published: false, createdAt: now, updatedAt: now,
    });
    copy.questions.forEach((q) => { q.id = uuid_(); });
    saveCourses_(courses.concat([copy]));
    return copy;
  }),

  deleteCourse: (req) => withLock_(() => {
    saveCourses_(getCourses_().filter((c) => c.id !== req.id));
    return true;
  }),

  attempts: () => readTable_('attempts')
    .map((a) => ({
      id: a.id, token: a.token, courseId: a.courseId, courseName: a.courseName, categoryName: a.categoryName,
      courseDate: a.courseDate, instructor: a.instructor,
      participant: { company: a.company, dept: a.dept, name: a.name, title: a.title, email: a.email },
      score: Number(a.score), total: Number(a.total), passScore: Number(a.passScore), passed: bool_(a.passed),
      certNo: a.certNo, durationSec: a.durationSec === '' ? null : Number(a.durationSec), createdAt: a.createdAt,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),

  deleteAttempt: (req) => withLock_(() => {
    const sh = sheet_('attempts');
    const rows = readTable_('attempts');
    const idx = rows.findIndex((a) => a.id === req.id);
    if (idx < 0) throw fail_('找不到紀錄');
    sh.deleteRow(rows[idx]._row);
    return true;
  }),
};

// ======================= 課程／題庫 =======================

function publicInfo_() {
  const s = getSettings_();
  return { siteName: s.siteName, issuer: s.issuer, privacyNotice: s.privacyNotice, categories: sortedCategories_().map((c) => ({ id: c.id, name: c.name })) };
}

function sortedCategories_() {
  return readTable_('categories').sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function catName_(cats, id) {
  const c = cats.find((x) => x.id === id);
  return c ? c.name : '未分類';
}

function openCourse_(id) {
  const c = getCourses_().find((x) => x.id === id);
  if (!c || !c.published || c.questions.length === 0) throw fail_('找不到此課程或尚未開放測驗');
  return c;
}

function courseSummary_(c, cats) {
  cats = cats || readTable_('categories');
  return {
    id: c.id, categoryId: c.categoryId, categoryName: catName_(cats, c.categoryId), name: c.name, date: c.date,
    instructor: c.instructor, mode: c.mode, hours: c.hours, description: c.description, materialUrl: c.materialUrl,
    passScore: c.passScore, published: c.published, questionCount: c.questions.length, totalPoints: totalPoints_(c.questions),
    updatedAt: c.updatedAt,
  };
}

function letters_(idx) { return idx.map((i) => String.fromCharCode(65 + i)).join(','); }
function parseLetters_(s) {
  return String(s || '').toUpperCase().split(/[\s,，、]+/).filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? Number(x) - 1 : x.charCodeAt(0) - 65));
}

/** 從工作表讀出所有課程（含題目） */
function getCourses_() {
  const qs = readTable_('questions');
  return readTable_('courses').map((c) => ({
    id: c.id, categoryId: c.categoryId, name: c.name, date: c.date, instructor: c.instructor, mode: c.mode,
    hours: c.hours === '' ? null : Number(c.hours), description: c.description, materialUrl: c.materialUrl,
    passScore: Number(c.passScore), shuffleQuestions: bool_(c.shuffleQuestions), shuffleOptions: bool_(c.shuffleOptions),
    published: bool_(c.published), createdAt: c.createdAt, updatedAt: c.updatedAt,
    questions: qs.filter((q) => q.courseId === c.id)
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map((q) => {
        const type = TYPES.indexOf(q.type) >= 0 ? q.type : 'single';
        const options = type === 'tf' ? TF_OPTIONS.slice() : String(q.options).split('\n').map((o) => o.trim()).filter((o) => o !== '');
        return {
          id: q.id, type: type, text: q.text, options: options,
          answer: parseLetters_(q.answer).filter((i) => i >= 0 && i < options.length),
          points: Number(q.points) || 0, explanation: q.explanation,
        };
      }),
  }));
}

function saveCourses_(courses) {
  writeTable_('courses', courses.map((c) => Object.assign({}, c, { questions: undefined })));
  const rows = [];
  courses.forEach((c) => c.questions.forEach((q, i) => rows.push({
    id: q.id, courseId: c.id, order: i + 1, type: q.type, text: q.text,
    options: q.type === 'tf' ? '' : q.options.join('\n'), answer: letters_(q.answer), points: q.points, explanation: q.explanation,
  })));
  writeTable_('questions', rows);
}

function normalizeQuestion_(raw, index) {
  const n = index + 1;
  const type = TYPES.indexOf(raw.type) >= 0 ? raw.type : 'single';
  const text = str_(raw.text, 4000);
  if (!text) throw fail_('第 ' + n + ' 題：題目內容不可空白');
  let options = type === 'tf' ? TF_OPTIONS.slice() : (Array.isArray(raw.options) ? raw.options.map((o) => str_(o, 1000).replace(/\n/g, ' ')) : []);
  if (type !== 'tf') {
    options = options.filter((o) => o !== '');
    if (options.length < 2) throw fail_('第 ' + n + ' 題：至少需要 2 個選項');
    if (options.length > 10) throw fail_('第 ' + n + ' 題：選項最多 10 個');
  }
  let answer = Array.isArray(raw.answer) ? raw.answer.map(Number) : [];
  answer = answer.filter((i, k) => Number.isInteger(i) && i >= 0 && i < options.length && answer.indexOf(i) === k).sort((a, b) => a - b);
  if (answer.length === 0) throw fail_('第 ' + n + ' 題：請設定正確答案');
  if (type !== 'multiple' && answer.length !== 1) throw fail_('第 ' + n + ' 題：單選／是非題只能有 1 個正確答案');
  const points = Number(raw.points);
  if (raw.points === '' || !isFinite(points) || points < 0 || points > 1000) throw fail_('第 ' + n + ' 題：配分需為 0～1000 的數字');
  return {
    id: str_(raw.id, 64) || uuid_(), type: type, text: text, options: options, answer: answer,
    points: Math.round(points * 100) / 100, explanation: str_(raw.explanation, 4000),
  };
}

function normalizeCourse_(body, existing) {
  const name = str_(body.name, 200);
  if (!name) throw fail_('請輸入課程名稱');
  if (!readTable_('categories').some((c) => c.id === body.categoryId)) throw fail_('請選擇課程類別');
  const date = str_(body.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail_('上課日期格式不正確');
  const questions = (Array.isArray(body.questions) ? body.questions : []).map(normalizeQuestion_);
  if (JSON.stringify(questions).length > MAX_CELL) throw fail_('題庫內容過大（超過試算表儲存格上限），請拆分為多個課程');
  const passScore = Number(body.passScore);
  if (body.passScore === '' || !isFinite(passScore) || passScore < 0) throw fail_('及格分數需為 0 以上的數字');
  const total = totalPoints_(questions);
  if (questions.length > 0 && passScore > total) throw fail_('及格分數（' + passScore + '）不可高於總分（' + total + '）');
  const hours = body.hours === '' || body.hours == null ? null : Number(body.hours);
  if (hours !== null && (!isFinite(hours) || hours < 0)) throw fail_('課程時數需為數字');
  const materialUrl = str_(body.materialUrl, 1000);
  if (materialUrl && !/^https?:\/\//i.test(materialUrl)) throw fail_('教材連結需以 http:// 或 https:// 開頭');
  const now = new Date().toISOString();
  return {
    id: existing ? existing.id : uuid_(), categoryId: body.categoryId, name: name, date: date,
    instructor: str_(body.instructor, 100) || getSettings_().defaultInstructor || '',
    mode: str_(body.mode, 50), hours: hours, description: str_(body.description, 4000), materialUrl: materialUrl,
    passScore: passScore, shuffleQuestions: !!body.shuffleQuestions, shuffleOptions: !!body.shuffleOptions,
    published: !!body.published && questions.length > 0, questions: questions,
    createdAt: existing ? existing.createdAt : now, updatedAt: now,
  };
}

function totalPoints_(questions) {
  return Math.round(questions.reduce((s, q) => s + (Number(q.points) || 0), 0) * 100) / 100;
}

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** 給考生的題目：不含答案與解析；選項附原始索引以便亂序後正確評分 */
function publicQuiz_(course) {
  let qs = course.questions.map((q) => {
    let opts = q.options.map((text, i) => ({ i: i, text: text }));
    if (course.shuffleOptions && q.type !== 'tf') opts = shuffle_(opts);
    return { id: q.id, type: q.type, text: q.text, points: q.points, options: opts };
  });
  if (course.shuffleQuestions) qs = shuffle_(qs);
  return qs;
}

/** 評分：複選題需完全答對才給分 */
function grade_(questions, answers) {
  answers = answers && typeof answers === 'object' ? answers : {};
  let score = 0;
  let correctCount = 0;
  const detail = questions.map((q) => {
    let given = answers[q.id];
    if (!Array.isArray(given)) given = given == null ? [] : [given];
    given = given.map(Number).filter((i, k, arr) => Number.isInteger(i) && i >= 0 && i < q.options.length && arr.indexOf(i) === k);
    if (q.type !== 'multiple') given = given.slice(0, 1);
    const sa = given.slice().sort((a, b) => a - b);
    const sb = q.answer.slice().sort((a, b) => a - b);
    const correct = sa.length > 0 && sa.length === sb.length && sa.every((v, i) => v === sb[i]);
    if (correct) { score += Number(q.points) || 0; correctCount++; }
    return { id: q.id, given: given, correct: correct };
  });
  return {
    score: Math.round(score * 100) / 100, total: totalPoints_(questions),
    correctCount: correctCount, questionCount: questions.length, detail: detail,
  };
}

// ======================= 設定／驗證 =======================

function getSettings_() {
  const s = {};
  readTable_('settings').forEach((r) => { s[r.key] = r.value; });
  return s;
}

function props_() { return PropertiesService.getScriptProperties(); }

function isAdmin_(token) {
  if (!token) return false;
  const cache = CacheService.getScriptCache();
  if (!cache.get('sess_' + token)) return false;
  cache.put('sess_' + token, '1', SESSION_TTL); // 滑動延長
  return true;
}

function requireAdmin_(token) {
  if (!isAdmin_(token)) { const e = fail_('請先登入後台'); e.code = 'AUTH'; throw e; }
}

function hex_(bytes) {
  return bytes.map((b) => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function hashPassword_(pw, salt) {
  salt = salt || uuid_().replace(/-/g, '');
  let h = pw;
  for (let i = 0; i < 200; i++) h = hex_(Utilities.computeHmacSha256Signature(h, salt));
  return 'hmac$' + salt + '$' + h;
}

function verifyPassword_(pw, stored) {
  if (!stored) return false;
  const salt = String(stored).split('$')[1];
  return hashPassword_(pw, salt) === stored;
}

function nextCertNo_(date) {
  const ymd = Utilities.formatDate(date, ss_().getSpreadsheetTimeZone(), 'yyyyMMdd');
  const key = 'cert-' + ymd;
  const n = Number(props_().getProperty(key) || 0) + 1;
  props_().setProperty(key, String(n));
  return (getSettings_().certPrefix || 'ISMS') + '-' + ymd + '-' + ('000' + n).slice(-4);
}

// ======================= 試算表存取 =======================

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(key) {
  const def = SHEETS[key];
  let sh = ss_().getSheetByName(def.name);
  if (!sh) {
    sh = ss_().insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function cellIn_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  const s = String(v);
  if (s.length > MAX_CELL) throw fail_('資料內容過長');
  return /^[=+\-@']/.test(s) ? "'" + s : s; // 避免被試算表當成公式執行
}

function cellOut_(v, header) {
  if (v instanceof Date) {
    return /date$/i.test(header) ? Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd') : v.toISOString();
  }
  if (typeof v === 'string' && v.charAt(0) === "'") return v.slice(1);
  return v;
}

function readTable_(key) {
  const sh = sheet_(key);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = Math.max(sh.getLastColumn(), 1);
  const values = sh.getRange(1, 1, last, width).getValues();
  const head = values[0].map(String);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row.some((c) => c !== '' && c !== null)) continue;
    const o = { _row: r + 1 };
    head.forEach((h, i) => { if (h) o[h] = cellOut_(row[i], h); });
    out.push(o);
  }
  return out;
}

function writeTable_(key, rows) {
  const def = SHEETS[key];
  const sh = sheet_(key);
  const data = [def.headers].concat(rows.map((o) => def.headers.map((h) => cellIn_(o[h]))));
  sh.clearContents();
  sh.getRange(1, 1, data.length, def.headers.length).setNumberFormat('@').setValues(data);
}

function appendRow_(key, obj) {
  const def = SHEETS[key];
  const sh = sheet_(key);
  const row = def.headers.map((h) => cellIn_(obj[h]));
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ======================= 工具 =======================

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg) {
  const e = new Error(msg);
  e.userMessage = msg;
  return e;
}

function str_(v, max) {
  return (v === null || v === undefined ? '' : String(v)).trim().slice(0, max || 2000);
}

function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function uuid_() { return Utilities.getUuid(); }

// ======================= 初始化與範例資料 =======================

function init_(force) {
  if (!force && props_().getProperty('initialized') === 'true') return;
  withLock_(() => {
    Object.keys(SHEETS).forEach(sheet_);
    if (readTable_('settings').length === 0) {
      writeTable_('settings', SETTING_KEYS.map((k) => ({ key: k, value: DEFAULT_SETTINGS[k] })));
    }
    if (readTable_('categories').length === 0 && readTable_('courses').length === 0) seed_();
    if (!props_().getProperty('adminPasswordHash')) {
      props_().setProperty('adminPasswordHash', hashPassword_('admin1234'));
      props_().setProperty('mustChangePassword', 'true');
    }
    // 移除新試算表預設的空白工作表
    const blank = ss_().getSheetByName('工作表1') || ss_().getSheetByName('Sheet1');
    if (blank && blank.getLastRow() === 0 && ss_().getSheets().length > 1) ss_().deleteSheet(blank);
    props_().setProperty('initialized', 'true');
  });
}

const DEFAULT_SETTINGS = {
  siteName: 'ISMS 課程課後測驗',
  issuer: 'ISMS 資訊安全管理課程',
  certTitle: '課程測驗合格證書',
  certPrefix: 'ISMS',
  defaultInstructor: '羅宇倫 Allan Lo',
  privacyNotice:
    '依據《個人資料保護法》第8條規定，本網站蒐集您的公司名稱、單位、姓名、職稱及電子郵件，' +
    '目的為「教育或訓練行政」及「課程測驗與證書核發」（特定目的代號：109 教育或訓練行政），' +
    '利用期間為課程結束後至訓練紀錄保存期限屆滿為止，利用地區為中華民國境內，' +
    '利用對象為課程主辦單位與講師，利用方式為測驗成績登錄、證書核發及訓練紀錄查核。' +
    '您可依個資法第3條行使查詢、閱覽、製給複本、補充更正、停止蒐集處理利用及刪除之權利，' +
    '請洽課程主辦單位。若您不提供上述資料，將無法完成測驗及核發證書。',
};

function seed_() {
  const q = (type, text, options, answer, explanation) =>
    ({ id: uuid_(), type: type, text: text, options: type === 'tf' ? TF_OPTIONS.slice() : options, answer: answer, points: 10, explanation: explanation });
  const catA = { id: uuid_(), name: '資安宣導', order: 1 };
  const catB = { id: uuid_(), name: '專業課程', order: 2 };
  const now = new Date().toISOString();
  const today = Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const base = {
    date: today, instructor: DEFAULT_SETTINGS.defaultInstructor, mode: '實體／線上', materialUrl: '', passScore: 70,
    shuffleQuestions: false, shuffleOptions: false, published: true, createdAt: now, updatedAt: now,
  };
  const awareness = Object.assign({}, base, {
    id: uuid_(), categoryId: catA.id, name: '資訊安全意識宣導', hours: 2,
    description: '涵蓋社交工程防範、密碼管理、資料保護、資安事件通報與個資保護基本觀念。',
    questions: [
      q('single', '收到一封自稱公司 IT 部門的電子郵件，要求您點擊連結重新設定密碼，最適當的處理方式為何？',
        ['立即點擊連結完成密碼重設', '轉寄給同事請他們幫忙確認', '不點擊連結，透過已知的官方管道向 IT／資安窗口查證並通報', '直接刪除即可，不需任何後續動作'],
        [2], '可疑郵件應透過獨立且已知的管道查證，並通報資安窗口，以利組織及早攔阻同類釣魚郵件。'),
      q('tf', '為了方便記憶，可以將密碼寫在便利貼上並貼在螢幕旁。', null, [1],
        '密碼不應以明文方式記錄在他人可輕易取得之處，建議使用公司核可的密碼管理工具。'),
      q('multiple', '下列哪些屬於良好的密碼／身分驗證管理做法？（複選）',
        ['使用長度足夠且包含多種字元的通行碼或通行片語', '不同系統使用不同的密碼', '與同事共用帳號密碼以便職務代理', '啟用多因子驗證（MFA）'],
        [0, 1, 3], '帳號應個人專用，職務代理應透過授權機制處理，而非共用帳密。'),
      q('single', '暫時離開座位時，對電腦最適當的處置為何？',
        ['保持畫面開啟以便回來繼續工作', '關閉螢幕電源即可', '鎖定螢幕（例如 Windows 按 Win + L）', '請隔壁同事幫忙看著'],
        [2], '桌面淨空與螢幕淨空（Clear desk and clear screen）是基本的實體與人員安全要求。'),
      q('single', '發現電腦畫面出現勒索訊息、檔案無法開啟時，第一時間應如何處理？',
        ['依畫面指示付款以取回檔案', '中斷網路連線（拔除網路線／關閉 Wi-Fi），並立即通報資安窗口', '自行上網搜尋解密工具處理', '若無影響可先繼續工作，下班後再處理'],
        [1], '先隔離以避免擴散，並依資安事件通報程序立即通報，保留現場以利後續鑑識。'),
      q('tf', '公司機密文件可以使用個人雲端硬碟或私人通訊軟體傳送，以加快作業效率。', null, [1],
        '機密資訊應依資訊分級與處理規範，使用公司核可的傳輸管道。'),
      q('single', '資訊安全的三大要素「CIA」指的是？',
        ['機密性、完整性、可用性', '控制、稽核、授權', '機密性、識別性、可歸責性', '一致性、完整性、可靠性'],
        [0], 'CIA：Confidentiality（機密性）、Integrity（完整性）、Availability（可用性）。'),
      q('multiple', '下列哪些屬於社交工程的常見手法？（複選）',
        ['釣魚郵件（Phishing）', '假冒身分的電話詐騙（Vishing）', '尾隨他人進入門禁管制區域（Tailgating）', '定期安裝作業系統安全更新'],
        [0, 1, 2], '定期更新是防護措施而非攻擊手法。'),
      q('tf', '在公共 Wi-Fi 環境處理公務時，應透過公司核可的 VPN 進行連線。', null, [0],
        '公共網路可能遭竊聽或中間人攻擊，應使用加密通道。'),
      q('single', '依《個人資料保護法》，直接向當事人蒐集個人資料時，應如何處理？',
        ['只要當事人沒有反對即可蒐集', '應明確告知蒐集機關名稱、目的、資料類別、利用期間地區對象方式及當事人權利等事項', '僅需於公司內部公告即可', '取得主管同意即可'],
        [1], '個資法第8條規定直接蒐集時之法定告知事項。'),
    ],
  });
  const iso = Object.assign({}, base, {
    id: uuid_(), categoryId: catB.id, name: 'ISO/IEC 27001:2022 條文解析與導入實務', hours: 6,
    description: '說明 ISO/IEC 27001:2022 第 4～10 章要求、附錄 A 控制措施架構、風險評鑑與適用性聲明書（SoA）實務。',
    questions: [
      q('single', 'ISO/IEC 27001:2022 附錄 A 共有多少項控制措施？', ['114', '93', '100', '133'], [1],
        '2022 版由 2013 版的 114 項整併為 93 項。'),
      q('single', 'ISO/IEC 27001:2022 附錄 A 控制措施分為哪四大主題？',
        ['組織、人員、實體、技術', '政策、程序、作業、紀錄', '管理、技術、法規、稽核', '預防、偵測、回應、復原'],
        [0], '對應附錄 A 第 5～8 節：組織控制措施、人員控制措施、實體控制措施、技術控制措施。'),
      q('multiple', '下列哪些是 ISO/IEC 27001:2022 新增的控制措施？（複選）',
        ['威脅情資（Threat intelligence）', '使用雲端服務之資訊安全', '資料遮罩（Data masking）', '職責區隔（Segregation of duties）'],
        [0, 1, 2], '職責區隔於 2013 版即已存在（A.6.1.2），2022 版為 5.3。'),
      q('single', '依 6.1.3，適用性聲明書（SoA）應包含哪些內容？',
        ['僅列出已實施的控制措施', '所需之控制措施及納入理由、是否已實施，以及排除附錄 A 控制措施之理由', '僅列出風險評鑑結果', '僅列出被排除的控制措施'],
        [1], 'SoA 須說明必要控制措施、納入理由、實施狀態及排除理由。'),
      q('single', '條款 4.1「瞭解組織及其全景」要求組織決定什麼？',
        ['資訊安全目標', '與其目的相關且影響其達成 ISMS 預期結果能力之外部及內部議題', '內部稽核方案', '矯正措施'],
        [1], '4.1 為內外部議題；4.2 為利害相關者需要與期望。'),
      q('tf', '依 ISO/IEC 27001:2022，組織必須實施附錄 A 全部 93 項控制措施，不得排除。', null, [1],
        '控制措施依風險處理需要選擇，排除者須於 SoA 中說明理由。'),
      q('single', '管理審查的要求位於標準的哪一章？', ['第 7 章 支援', '第 8 章 運作', '第 9 章 績效評估', '第 10 章 改善'],
        [2], '管理審查為 9.3；內部稽核為 9.2。'),
      q('single', 'ISO/IEC 27001:2022 主文新增了下列哪一個條款？',
        ['6.3 變更之規劃', '7.5 文件化資訊', '9.2 內部稽核', '10.2 不符合事項及矯正措施'],
        [0], '2022 版依 ISO 調和架構新增 6.3 Planning of changes。'),
      q('multiple', '依 6.1.2，資訊安全風險評鑑過程應符合下列哪些要求？（複選）',
        ['建立並維持資訊安全風險準則，包括風險接受準則', '確保重複執行之風險評鑑產生一致、有效且可比較之結果', '識別風險擁有者', '一律採用定量分析方法'],
        [0, 1, 2], '標準未限定定性或定量方法。'),
      q('tf', '資訊安全目標應可量測（若可行），並予以監督、傳達及適當更新。', null, [0],
        '依 6.2，資訊安全目標應可量測（若可行）並予以監督。'),
    ],
  });
  writeTable_('categories', [catA, catB]);
  saveCourses_([awareness, iso]);
}
