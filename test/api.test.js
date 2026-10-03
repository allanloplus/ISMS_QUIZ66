'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

let server, base, store, cookie = '';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isms-quiz-'));

async function call(method, url, body, withCookie) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(withCookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const participant = { company: '測試股份有限公司', dept: '資訊部', name: '王小明', title: '工程師', email: 'test@example.com' };

test.before(async () => {
  ({ app: server, store } = createApp({ dataDir: dir, adminPassword: 'secret-pass' }));
  server = server.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('前台課程列表與題目不含答案', async () => {
  const { data } = await call('GET', '/api/public/courses');
  assert.equal(data.length, 2);
  const quiz = await call('GET', `/api/public/courses/${data[0].id}/quiz`);
  assert.equal(quiz.status, 200);
  for (const q of quiz.data.questions) {
    assert.equal(q.answer, undefined);
    assert.equal(q.explanation, undefined);
  }
});

test('必填欄位與個資同意檢查', async () => {
  const c = store.db.courses[0];
  let r = await call('POST', `/api/public/courses/${c.id}/submit`, { participant: { ...participant, title: '' }, consent: true, answers: {} });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /職稱/);
  r = await call('POST', `/api/public/courses/${c.id}/submit`, { participant: { ...participant, email: 'bad' }, consent: true, answers: {} });
  assert.equal(r.status, 400);
  r = await call('POST', `/api/public/courses/${c.id}/submit`, { participant, consent: false, answers: {} });
  assert.equal(r.status, 400);
});

test('未通過：不回傳證書與答案', async () => {
  const c = store.db.courses[0];
  const r = await call('POST', `/api/public/courses/${c.id}/submit`, { participant, consent: true, answers: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.passed, false);
  assert.equal(r.data.score, 0);
  assert.equal(r.data.certificateUrl, undefined);
});

test('全對通過：產生證書、可查驗、附題目解答', async () => {
  const c = store.db.courses[0];
  const answers = Object.fromEntries(c.questions.map((q) => [q.id, q.answer]));
  const r = await call('POST', `/api/public/courses/${c.id}/submit`, { participant, consent: true, answers, startedAt: new Date().toISOString() });
  assert.equal(r.data.passed, true);
  assert.equal(r.data.score, 100);
  assert.match(r.data.certNo, /^ISMS-\d{8}-0001$/);
  const u = new URL(r.data.certificateUrl, base);
  const cert = await call('GET', `/api/public/certificates/${u.searchParams.get('id')}?t=${u.searchParams.get('t')}`);
  assert.equal(cert.status, 200);
  assert.equal(cert.data.participant.name, '王小明');
  assert.equal(cert.data.questions.length, c.questions.length);
  assert.ok(cert.data.questions[0].answer);
  const wrongToken = await call('GET', `/api/public/certificates/${u.searchParams.get('id')}?t=${'0'.repeat(48)}`);
  assert.equal(wrongToken.status, 404);
  const v = await call('GET', `/api/public/verify/${r.data.certNo}`);
  assert.equal(v.data.valid, true);
  assert.equal(v.data.name, '王○明');
});

test('複選題需完全答對才給分', async () => {
  const c = store.db.courses[0];
  const multi = c.questions.find((q) => q.type === 'multiple');
  const answers = Object.fromEntries(c.questions.map((q) => [q.id, q.answer]));
  answers[multi.id] = multi.answer.slice(0, 1);
  const r = await call('POST', `/api/public/courses/${c.id}/submit`, { participant, consent: true, answers });
  assert.equal(r.data.score, 100 - multi.points);
});

test('後台需登入；登入後可新增課程與題庫', async () => {
  assert.equal((await call('GET', '/api/admin/courses', undefined, true)).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'secret-pass' })).status, 200);
  const cats = (await call('GET', '/api/admin/categories', undefined, true)).data;
  assert.deepEqual(cats.map((c) => c.name), ['資安宣導', '專業課程']);

  const bad = await call('POST', '/api/admin/courses', { name: 'X', categoryId: cats[0].id, passScore: 50,
    questions: [{ type: 'single', text: 'Q', options: ['a', 'b'], answer: [], points: 10 }] }, true);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /正確答案/);

  const tooHigh = await call('POST', '/api/admin/courses', { name: 'X', categoryId: cats[0].id, passScore: 50,
    questions: [{ type: 'tf', text: 'Q', answer: [0], points: 10 }] }, true);
  assert.match(tooHigh.data.error, /不可高於總分/);

  const ok = await call('POST', '/api/admin/courses', {
    name: '新課程', categoryId: cats[1].id, date: '2026-10-03', instructor: '', passScore: 15, published: true,
    questions: [
      { type: 'tf', text: '是非', answer: [0], points: 10 },
      { type: 'multiple', text: '複選', options: ['a', 'b', 'c'], answer: [2, 0], points: 10 },
    ],
  }, true);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.instructor, '羅宇倫 Allan Lo');
  assert.deepEqual(ok.data.questions[1].answer, [0, 2]);
  assert.equal((await call('GET', '/api/public/courses')).data.length, 3);

  const csv = await fetch(base + '/api/admin/attempts.csv', { headers: { Cookie: cookie } });
  const buf = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM，Excel 開啟不亂碼
  const text = buf.toString('utf8');
  assert.ok(text.includes('"測驗時間"'));
  assert.ok(text.includes('王小明'));
});
