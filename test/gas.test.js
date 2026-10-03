'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createGas } = require('../tools/gas-mock');

const gas = createGas();
const ok = (r) => { assert.equal(r.ok, true, r.error); return r.data; };
const participant = { company: '測試股份有限公司', dept: '資訊部', name: '王小明', title: '工程師', email: 'Test@Example.com' };
let token;

test('初始化：建立工作表、範例課程，移除空白工作表', () => {
  const home = ok(gas.call('home'));
  assert.equal(home.courses.length, 2);
  assert.deepEqual(home.info.categories.map((c) => c.name), ['資安宣導', '專業課程']);
  assert.deepEqual(gas.sheets.map((s) => s.name), ['設定', '課程類別', '課程', '題庫', '測驗紀錄']);
  assert.equal(ok(gas.call('quiz', { courseId: home.courses[0].id })).questions.length, 10);
});

test('前台題目不含答案與解析', () => {
  const { courses } = ok(gas.call('home'));
  for (const q of ok(gas.call('quiz', { courseId: courses[0].id })).questions) {
    assert.equal(q.answer, undefined);
    assert.equal(q.explanation, undefined);
  }
});

test('必填欄位與個資同意檢查', () => {
  const { courses } = ok(gas.call('home'));
  const id = courses[0].id;
  assert.match(gas.call('submit', { courseId: id, participant: { ...participant, title: '' }, consent: true }).error, /職稱/);
  assert.match(gas.call('submit', { courseId: id, participant: { ...participant, email: 'x' }, consent: true }).error, /E-mail/);
  assert.match(gas.call('submit', { courseId: id, participant, consent: false }).error, /個人資料/);
});

test('後台需登入', () => {
  assert.equal(gas.call('adminCourses').code, 'AUTH');
  assert.equal(gas.call('login', { password: 'wrong' }).ok, false);
  const r = ok(gas.call('login', { password: 'admin1234' }));
  assert.equal(r.mustChangePassword, true);
  token = r.token;
  assert.equal(ok(gas.call('me', { token })).authed, true);
});

test('未通過不回傳證書；全對通過可取得證書並查驗', () => {
  const course = ok(gas.call('adminCourses', { token })).find((c) => c.name === '資訊安全意識宣導');
  const full = ok(gas.call('getCourse', { token, id: course.id }));
  const fail = ok(gas.call('submit', { courseId: course.id, participant, consent: true, answers: {} }));
  assert.equal(fail.passed, false);
  assert.equal(fail.token, undefined);

  const answers = Object.fromEntries(full.questions.map((q) => [q.id, q.answer]));
  const pass = ok(gas.call('submit', { courseId: course.id, participant, consent: true, answers, startedAt: new Date(Date.now() - 60000).toISOString() }));
  assert.equal(pass.passed, true);
  assert.equal(pass.score, 100);
  assert.match(pass.certNo, /^ISMS-\d{8}-0001$/);

  const cert = ok(gas.call('certificate', { id: pass.attemptId, t: pass.token }));
  assert.equal(cert.participant.name, '王小明');
  assert.equal(cert.participant.email, 'test@example.com');
  assert.equal(cert.questions.length, 10);
  assert.ok(cert.questions[0].explanation);
  assert.equal(gas.call('certificate', { id: pass.attemptId, t: 'bad' }).ok, false);

  const v = ok(gas.call('verify', { certNo: pass.certNo.toLowerCase() }));
  assert.equal(v.valid, true);
  assert.equal(v.name, '王○明');
  assert.equal(ok(gas.call('verify', { certNo: 'NOPE' })).valid, false);

  const list = ok(gas.call('attempts', { token }));
  assert.equal(list.length, 2);
  assert.equal(list.filter((a) => a.passed).length, 1);
});

test('複選題需完全答對才給分', () => {
  const course = ok(gas.call('adminCourses', { token })).find((c) => c.name === '資訊安全意識宣導');
  const full = ok(gas.call('getCourse', { token, id: course.id }));
  const multi = full.questions.find((q) => q.type === 'multiple');
  const answers = Object.fromEntries(full.questions.map((q) => [q.id, q.answer]));
  answers[multi.id] = multi.answer.slice(0, 1);
  assert.equal(ok(gas.call('submit', { courseId: course.id, participant, consent: true, answers })).score, 90);
});

test('後台新增課程、驗證題庫、公式字元安全保存', () => {
  const cats = ok(gas.call('categories', { token }));
  const bad = gas.call('saveCourse', { token, course: { name: 'X', categoryId: cats[0].id, passScore: 5,
    questions: [{ type: 'single', text: 'Q', options: ['a', 'b'], answer: [], points: 10 }] } });
  assert.match(bad.error, /正確答案/);
  const tooHigh = gas.call('saveCourse', { token, course: { name: 'X', categoryId: cats[0].id, passScore: 50,
    questions: [{ type: 'tf', text: 'Q', answer: [0], points: 10 }] } });
  assert.match(tooHigh.error, /不可高於總分/);

  const saved = ok(gas.call('saveCourse', { token, course: {
    name: '=HYPERLINK("x")', categoryId: cats[1].id, date: '2026-10-03', instructor: '', passScore: 15, published: true,
    questions: [
      { type: 'tf', text: '是非', answer: [0], points: 10 },
      { type: 'multiple', text: '-1 是負數嗎？', options: ['+1', '-1', '@x'], answer: [2, 1], points: 10, explanation: '' },
    ],
  } }));
  assert.equal(saved.instructor, '羅宇倫 Allan Lo');
  const back = ok(gas.call('getCourse', { token, id: saved.id }));
  assert.equal(back.name, '=HYPERLINK("x")');
  assert.deepEqual(back.questions[1].options, ['+1', '-1', '@x']);
  assert.deepEqual(back.questions[1].answer, [1, 2]);
  assert.equal(back.date, '2026-10-03');
  // 寫入試算表的值以單引號前綴，不會被當成公式
  const courseSheet = gas.sheets.find((s) => s.name === '課程');
  assert.ok(courseSheet.data.some((r) => r.includes('=HYPERLINK("x")')));
  assert.equal(ok(gas.call('home')).courses.length, 3);

  const dup = ok(gas.call('duplicateCourse', { token, id: saved.id }));
  assert.equal(dup.published, false);
  ok(gas.call('deleteCourse', { token, id: dup.id }));
  assert.equal(ok(gas.call('adminCourses', { token })).length, 3);
});

test('類別、設定、密碼變更', () => {
  ok(gas.call('saveCategory', { token, name: '主管課程' }));
  const cats = ok(gas.call('categories', { token }));
  assert.equal(cats.length, 3);
  assert.match(gas.call('deleteCategory', { token, id: cats[0].id }).error, /仍有課程/);
  ok(gas.call('deleteCategory', { token, id: cats[2].id }));
  assert.match(gas.call('saveSettings', { token, settings: { certPrefix: 'a-b' } }).error, /英文字母/);
  ok(gas.call('saveSettings', { token, settings: { certPrefix: 'abc', siteName: '測試網站' } }));
  assert.equal(ok(gas.call('info')).siteName, '測試網站');
  assert.match(gas.call('password', { token, current: 'x', next: '12345678' }).error, /目前密碼/);
  ok(gas.call('password', { token, current: 'admin1234', next: 'NewPass!234' }));
  assert.equal(gas.call('login', { password: 'admin1234' }).ok, false);
  assert.equal(ok(gas.call('login', { password: 'NewPass!234' })).mustChangePassword, false);
});

test('刪除測驗紀錄與登出', () => {
  const list = ok(gas.call('attempts', { token }));
  ok(gas.call('deleteAttempt', { token, id: list[0].id }));
  assert.equal(ok(gas.call('attempts', { token })).length, list.length - 1);
  ok(gas.call('logout', { token }));
  assert.equal(gas.call('attempts', { token }).code, 'AUTH');
});
