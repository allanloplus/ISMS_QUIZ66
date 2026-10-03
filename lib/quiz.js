'use strict';
// 題目驗證、出題（隱藏答案）與評分邏輯

const TYPES = ['single', 'multiple', 'tf'];
const TF_OPTIONS = ['正確', '錯誤'];

function str(v, max = 2000) {
  return (v == null ? '' : String(v)).trim().slice(0, max);
}

/** 驗證並正規化單一題目；錯誤時丟出含中文訊息的 Error */
function normalizeQuestion(raw, index, makeId) {
  const n = index + 1;
  const type = TYPES.includes(raw.type) ? raw.type : 'single';
  const text = str(raw.text, 4000);
  if (!text) throw new Error(`第 ${n} 題：題目內容不可空白`);

  let options = type === 'tf'
    ? TF_OPTIONS.slice()
    : (Array.isArray(raw.options) ? raw.options.map((o) => str(o, 1000)) : []);
  if (type !== 'tf') {
    options = options.filter((o) => o !== '');
    if (options.length < 2) throw new Error(`第 ${n} 題：至少需要 2 個選項`);
    if (options.length > 10) throw new Error(`第 ${n} 題：選項最多 10 個`);
  }

  let answer = Array.isArray(raw.answer) ? raw.answer : [];
  answer = [...new Set(answer.map(Number))]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < options.length)
    .sort((a, b) => a - b);
  if (answer.length === 0) throw new Error(`第 ${n} 題：請設定正確答案`);
  if (type !== 'multiple' && answer.length !== 1) throw new Error(`第 ${n} 題：單選／是非題只能有 1 個正確答案`);

  const points = Number(raw.points);
  if (!Number.isFinite(points) || points < 0 || points > 1000) throw new Error(`第 ${n} 題：配分需為 0～1000 的數字`);

  return {
    id: str(raw.id, 64) || makeId(),
    type,
    text,
    options,
    answer,
    points: Math.round(points * 100) / 100,
    explanation: str(raw.explanation, 4000),
  };
}

function totalPoints(questions) {
  return Math.round(questions.reduce((s, q) => s + (Number(q.points) || 0), 0) * 100) / 100;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 產生給考生的題目（不含答案與解析）；選項附原始索引以便亂序後仍能正確評分 */
function publicQuiz(course) {
  let qs = course.questions.map((q) => {
    let opts = q.options.map((text, i) => ({ i, text }));
    if (course.shuffleOptions && q.type !== 'tf') opts = shuffle(opts);
    return { id: q.id, type: q.type, text: q.text, points: q.points, options: opts };
  });
  if (course.shuffleQuestions) qs = shuffle(qs);
  return qs;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/** 評分：複選題需完全答對才給分 */
function grade(questions, answers) {
  answers = answers && typeof answers === 'object' ? answers : {};
  let score = 0;
  let correctCount = 0;
  const detail = questions.map((q) => {
    let given = answers[q.id];
    if (!Array.isArray(given)) given = given == null ? [] : [given];
    given = [...new Set(given.map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length);
    if (q.type !== 'multiple') given = given.slice(0, 1);
    const correct = given.length > 0 && sameSet(given, q.answer);
    if (correct) {
      score += Number(q.points) || 0;
      correctCount++;
    }
    return { id: q.id, given, correct };
  });
  return {
    score: Math.round(score * 100) / 100,
    total: totalPoints(questions),
    correctCount,
    questionCount: questions.length,
    detail,
  };
}

module.exports = { normalizeQuestion, publicQuiz, grade, totalPoints, TYPES, TF_OPTIONS, str };
