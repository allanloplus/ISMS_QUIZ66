'use strict';
(function () {
  const VIEWS = ['login', 'courses', 'editor', 'attempts', 'categories', 'settings'];
  let categories = [];
  let settings = {};
  let editing = null; // 編輯中的課程物件
  let dirty = false;

  function showView(name) {
    VIEWS.forEach((v) => $('#view-' + v).classList.toggle('hidden', v !== name));
    $$('#adminNav a[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === name || (name === 'editor' && a.dataset.view === 'courses')));
    window.scrollTo({ top: 0 });
  }

  async function guard(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e.code === 'AUTH') { adminToken(null); enterLogin(); return undefined; }
      toast(e.message, true);
      return undefined;
    }
  }

  function enterLogin() {
    $('#adminNav').classList.add('hidden');
    $('#pwWarning').classList.add('hidden');
    showView('login');
    $('#password').focus();
  }

  // ---------------- 路由 ----------------
  async function route() {
    const [view, arg] = (location.hash.slice(1) || 'courses').split('/');
    if (view !== 'edit' && view !== 'new') { dirty = false; editing = null; }
    if (view === 'courses') return loadCourses();
    if (view === 'new') return openEditor(null);
    if (view === 'edit') return openEditor(arg);
    if (view === 'attempts') return loadAttempts();
    if (view === 'categories') return loadCategories();
    if (view === 'settings') return loadSettings();
    location.hash = '#courses';
  }

  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('課程尚未儲存，確定要離開嗎？')) {
      history.replaceState(null, '', lastHash);
      return;
    }
    dirty = false;
    lastHash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  async function start() {
    const me = await api('me');
    if (!me.authed) return enterLogin();
    $('#adminNav').classList.remove('hidden');
    $('#pwWarning').classList.toggle('hidden', !me.mustChangePassword);
    categories = (await guard(() => api('categories'))) || [];
    route();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginForm button');
    btn.disabled = true;
    btn.textContent = '登入中…';
    try {
      const r = await api('login', { password: $('#password').value });
      adminToken(r.token);
      $('#password').value = '';
      $('#loginError').classList.add('hidden');
      start();
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginError').classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '登入';
    }
  });

  $('#logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    if (dirty && !confirm('課程尚未儲存，確定要登出嗎？')) return;
    dirty = false;
    try { await api('logout'); } catch (err) { /* 已過期亦視為登出 */ }
    adminToken(null);
    enterLogin();
  });

  // ---------------- 課程列表 ----------------
  async function loadCourses() {
    showView('courses');
    $('#courseRows').innerHTML = '<tr><td colspan="9" class="muted center">載入中…</td></tr>';
    const list = await guard(() => api('adminCourses'));
    if (!list) return;
    const catOrder = (id) => categories.findIndex((c) => c.id === id);
    list.sort((a, b) => catOrder(a.categoryId) - catOrder(b.categoryId) || (b.date || '').localeCompare(a.date || ''));
    $('#courseRows').innerHTML = list.length ? list.map((c) => `
      <tr>
        <td><span class="badge">${esc(c.categoryName)}</span></td>
        <td><b>${esc(c.name)}</b></td>
        <td>${esc(c.date)}</td>
        <td>${esc(c.instructor)}</td>
        <td>${c.questionCount} 題／${c.totalPoints} 分</td>
        <td>${c.passScore}</td>
        <td><a href="#attempts" data-filter-course="${esc(c.id)}">${c.attemptCount}（${c.passCount}）</a></td>
        <td>${c.published ? '<span class="badge ok">開放中</span>' : '<span class="badge gray">未開放</span>'}</td>
        <td class="row" style="gap:6px">
          <a class="btn sm" href="#edit/${esc(c.id)}">編輯</a>
          <button class="btn secondary sm" data-dup="${esc(c.id)}" type="button">複製</button>
          ${c.published ? `<a class="btn secondary sm" href="quiz.html?course=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">預覽</a>` : ''}
          <button class="btn danger sm" data-del="${esc(c.id)}" data-name="${esc(c.name)}" type="button">刪除</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="9" class="muted center">尚無課程，請點選「新增課程」。</td></tr>';
  }

  $('#newCourseBtn').addEventListener('click', () => { location.hash = '#new'; });

  $('#courseRows').addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.filterCourse) { pendingCourseFilter = t.dataset.filterCourse; return; }
    if (t.dataset.dup) {
      const c = await guard(() => api('duplicateCourse', { id: t.dataset.dup }));
      if (c) { toast('已複製課程（預設為未開放）'); loadCourses(); }
    }
    if (t.dataset.del) {
      if (!confirm(`確定刪除課程「${t.dataset.name}」？\n題庫將一併刪除（已發出的證書與測驗紀錄會保留）。`)) return;
      const r = await guard(() => api('deleteCourse', { id: t.dataset.del }));
      if (r) { toast('已刪除'); loadCourses(); }
    }
  });

  // ---------------- 課程編輯 ----------------
  function blankQuestion(type) {
    return {
      id: '', type, text: '',
      options: type === 'tf' ? ['正確', '錯誤'] : ['', '', '', ''],
      answer: [], points: 10, explanation: '',
    };
  }

  async function openEditor(id) {
    if (!categories.length) categories = (await guard(() => api('categories'))) || [];
    if (!settings.defaultInstructor) settings = (await guard(() => api('getSettings'))) || {};
    if (id) {
      const c = await guard(() => api('getCourse', { id }));
      if (!c) { location.hash = '#courses'; return; }
      editing = c;
    } else {
      editing = {
        id: null, categoryId: (categories[0] || {}).id, name: '', date: new Date().toISOString().slice(0, 10),
        instructor: settings.defaultInstructor || '羅宇倫 Allan Lo', mode: '實體／線上', hours: '', description: '', materialUrl: '',
        passScore: 70, shuffleQuestions: false, shuffleOptions: false, published: false, questions: [],
      };
    }
    $('#editorTitle').textContent = id ? '編輯課程' : '新增課程';
    $('#f_categoryId').innerHTML = categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    for (const k of ['categoryId', 'name', 'date', 'instructor', 'mode', 'hours', 'description', 'materialUrl', 'passScore']) {
      $('#f_' + k).value = editing[k] ?? '';
    }
    for (const k of ['shuffleQuestions', 'shuffleOptions', 'published']) $('#f_' + k).checked = !!editing[k];
    renderQuestions();
    dirty = false;
    showView('editor');
  }

  function renderQuestions() {
    const qs = editing.questions;
    $('#qList').innerHTML = qs.length ? qs.map((q, n) => {
      const multi = q.type === 'multiple';
      return `
      <div class="qedit" data-n="${n}">
        <div class="qedit-head">
          <strong>第 ${n + 1} 題</strong>
          <select data-f="type" style="width:auto">
            <option value="single"${q.type === 'single' ? ' selected' : ''}>單選題</option>
            <option value="multiple"${multi ? ' selected' : ''}>複選題</option>
            <option value="tf"${q.type === 'tf' ? ' selected' : ''}>是非題</option>
          </select>
          <span class="row" style="gap:4px">配分 <input type="number" data-f="points" value="${esc(q.points)}" min="0" step="0.5" style="width:80px"> 分</span>
          <span class="spacer"></span>
          <button class="btn secondary sm" type="button" data-act="up" ${n === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn secondary sm" type="button" data-act="down" ${n === qs.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn secondary sm" type="button" data-act="copy">複製</button>
          <button class="btn danger sm" type="button" data-act="remove">刪除</button>
        </div>
        <textarea data-f="text" placeholder="請輸入題目內容">${esc(q.text)}</textarea>
        <div style="margin-top:10px">
          <div class="small muted" style="margin-bottom:6px">選項（勾選正確答案${multi ? '，可複選' : ''}）</div>
          ${q.options.map((o, i) => `
            <div class="opt-row">
              <label class="mark"><input type="${multi ? 'checkbox' : 'radio'}" name="ans_${n}" data-ans="${i}" ${q.answer.includes(i) ? 'checked' : ''}> ${OPT_LETTER(i)}</label>
              <input type="text" data-opt="${i}" value="${esc(o)}" ${q.type === 'tf' ? 'readonly' : ''} placeholder="選項內容">
              ${q.type !== 'tf' ? `<button class="btn secondary sm" type="button" data-act="delopt" data-i="${i}" ${q.options.length <= 2 ? 'disabled' : ''}>✕</button>` : ''}
            </div>`).join('')}
          ${q.type !== 'tf' && q.options.length < 10 ? '<button class="btn secondary sm" type="button" data-act="addopt">＋ 新增選項</button>' : ''}
        </div>
        <div style="margin-top:10px"><label class="small">解析（通過後顯示於證書附件，選填）</label>
          <textarea data-f="explanation" style="min-height:50px">${esc(q.explanation)}</textarea></div>
      </div>`;
    }).join('') : '<p class="muted">尚無題目，請使用下方按鈕新增。</p>';
    updateSummary();
  }

  function totalPoints() {
    return Math.round(editing.questions.reduce((s, q) => s + (Number(q.points) || 0), 0) * 100) / 100;
  }

  function updateSummary() {
    const total = totalPoints();
    const pass = Number($('#f_passScore').value) || 0;
    $('#sumCount').textContent = editing.questions.length;
    $('#sumTotal').textContent = total;
    $('#sumPass').textContent = `${pass} 分`;
    $('#sumWarn').textContent = editing.questions.length && pass > total ? '及格分數高於總分' : '';
    if (editing.questions.length && total > 0) $('#sumPass').textContent = `${pass} 分（${Math.round((pass / total) * 1000) / 10}%）`;
  }

  $('#courseForm').addEventListener('input', (e) => {
    dirty = true;
    const t = e.target;
    const box = t.closest('.qedit');
    if (box) {
      const q = editing.questions[Number(box.dataset.n)];
      if (t.dataset.f === 'text' || t.dataset.f === 'explanation') q[t.dataset.f] = t.value;
      if (t.dataset.f === 'points') { q.points = t.value === '' ? '' : Number(t.value); }
      if (t.dataset.opt !== undefined) q.options[Number(t.dataset.opt)] = t.value;
    }
    updateSummary();
  });

  $('#courseForm').addEventListener('change', (e) => {
    const t = e.target;
    const box = t.closest('.qedit');
    if (!box) return;
    dirty = true;
    const q = editing.questions[Number(box.dataset.n)];
    if (t.dataset.f === 'type') {
      const old = q.type;
      q.type = t.value;
      if (q.type === 'tf') { q.options = ['正確', '錯誤']; q.answer = []; }
      else if (old === 'tf') { q.options = ['', '', '', '']; q.answer = []; }
      else if (q.type === 'single') q.answer = q.answer.slice(0, 1);
      renderQuestions();
    }
    if (t.dataset.ans !== undefined) {
      const i = Number(t.dataset.ans);
      if (q.type === 'multiple') {
        q.answer = t.checked ? [...new Set([...q.answer, i])].sort((a, b) => a - b) : q.answer.filter((x) => x !== i);
      } else q.answer = [i];
    }
  });

  $('#qList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const n = Number(b.closest('.qedit').dataset.n);
    const qs = editing.questions;
    const q = qs[n];
    switch (b.dataset.act) {
      case 'up': [qs[n - 1], qs[n]] = [qs[n], qs[n - 1]]; break;
      case 'down': [qs[n + 1], qs[n]] = [qs[n], qs[n + 1]]; break;
      case 'copy': qs.splice(n + 1, 0, { ...JSON.parse(JSON.stringify(q)), id: '' }); break;
      case 'remove': if (!confirm(`確定刪除第 ${n + 1} 題？`)) return; qs.splice(n, 1); break;
      case 'addopt': q.options.push(''); break;
      case 'delopt': {
        const i = Number(b.dataset.i);
        q.options.splice(i, 1);
        q.answer = q.answer.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
        break;
      }
      default: return;
    }
    dirty = true;
    renderQuestions();
  });

  $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
    editing.questions.push(blankQuestion(b.dataset.add));
    dirty = true;
    renderQuestions();
    const last = $$('.qedit').pop();
    if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('textarea', last).focus(); }
  }));

  // 平均分配分數：整數配分，餘數由最後幾題各加 1 分
  $('#distBtn').addEventListener('click', () => {
    const n = editing.questions.length;
    const T = Math.round(Number($('#distTotal').value));
    if (!n) return toast('尚無題目', true);
    if (!(T > 0)) return toast('請輸入正確的總分', true);
    const base = Math.floor(T / n);
    const rem = T - base * n;
    editing.questions.forEach((q, i) => { q.points = base + (i >= n - rem ? 1 : 0); });
    dirty = true;
    renderQuestions();
    toast(`已將總分 ${T} 分平均分配至 ${n} 題`);
  });

  $('#editorBack').addEventListener('click', () => { location.hash = '#courses'; });

  $('#exportQ').addEventListener('click', () => {
    const data = editing.questions.map(({ id, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${$('#f_name').value || 'questions'}-題庫.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importQ').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const arr = JSON.parse(await file.text());
      if (!Array.isArray(arr)) throw new Error('格式錯誤：需為題目陣列');
      const imported = arr.map((q) => ({
        id: '', type: ['single', 'multiple', 'tf'].includes(q.type) ? q.type : 'single', text: String(q.text || ''),
        options: Array.isArray(q.options) ? q.options.map(String) : [], answer: Array.isArray(q.answer) ? q.answer.map(Number) : [],
        points: Number(q.points) || 0, explanation: String(q.explanation || ''),
      }));
      editing.questions.push(...imported);
      dirty = true;
      renderQuestions();
      toast(`已匯入 ${imported.length} 題（尚未儲存）`);
    } catch (err) {
      toast('匯入失敗：' + err.message, true);
    }
  });

  $('#courseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { ...editing };
    for (const k of ['categoryId', 'name', 'date', 'instructor', 'mode', 'hours', 'description', 'materialUrl', 'passScore']) body[k] = $('#f_' + k).value;
    for (const k of ['shuffleQuestions', 'shuffleOptions', 'published']) body[k] = $('#f_' + k).checked;
    if (body.published && !body.questions.length) return toast('題庫至少需要 1 題才能開放測驗', true);
    $('#saveBtn').disabled = true;
    $('#saveBtn').textContent = '儲存中…';
    const saved = await guard(() => api('saveCourse', { course: body }));
    $('#saveBtn').disabled = false;
    $('#saveBtn').textContent = '儲存課程';
    if (!saved) return;
    toast('課程已儲存');
    dirty = false;
    if (!editing.id) {
      lastHash = '#edit/' + saved.id;
      history.replaceState(null, '', lastHash);
    }
    editing = saved;
    $('#editorTitle').textContent = '編輯課程';
    $('#f_published').checked = saved.published;
    renderQuestions();
  });

  // ---------------- 測驗紀錄 ----------------
  let pendingCourseFilter = '';

  let allAttempts = [];

  function filteredAttempts() {
    const courseId = $('#a_course').value;
    const status = $('#a_status').value;
    const kw = $('#a_q').value.trim().toLowerCase();
    return allAttempts.filter((a) => (!courseId || a.courseId === courseId)
      && (!status || (status === 'passed') === a.passed)
      && (!kw || [a.participant.company, a.participant.dept, a.participant.name, a.participant.title, a.participant.email, a.certNo]
        .some((v) => String(v || '').toLowerCase().includes(kw))));
  }

  async function loadAttempts(keepFilter) {
    showView('attempts');
    if (!keepFilter) {
      $('#attemptRows').innerHTML = '<tr><td colspan="11" class="muted center">載入中…</td></tr>';
      const [courses, list] = await Promise.all([guard(() => api('adminCourses')), guard(() => api('attempts'))]);
      if (!courses || !list) return;
      const cur = pendingCourseFilter || $('#a_course').value;
      $('#a_course').innerHTML = '<option value="">全部課程</option>' +
        courses.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
      $('#a_course').value = courses.some((c) => c.id === cur) ? cur : '';
      pendingCourseFilter = '';
      allAttempts = list;
    }
    const list = filteredAttempts();
    const passed = list.filter((a) => a.passed).length;
    $('#attemptStats').textContent = `共 ${list.length} 筆，通過 ${passed} 筆，未通過 ${list.length - passed} 筆` +
      (list.length ? `，通過率 ${Math.round((passed / list.length) * 1000) / 10}%` : '');
    $('#attemptRows').innerHTML = list.length ? list.map((a) => `
      <tr>
        <td style="white-space:nowrap">${esc(fmtDateTime(a.createdAt))}</td>
        <td>${esc(a.courseName)}</td>
        <td>${esc(a.participant.company)}</td>
        <td>${esc(a.participant.dept)}</td>
        <td>${esc(a.participant.name)}</td>
        <td>${esc(a.participant.title)}</td>
        <td>${esc(a.participant.email)}</td>
        <td>${a.score} / ${a.total}</td>
        <td>${a.passed ? '<span class="badge ok">通過</span>' : '<span class="badge bad">未通過</span>'}</td>
        <td style="white-space:nowrap">${esc(a.certNo || '—')}</td>
        <td class="row" style="gap:6px">
          ${a.passed ? `<a class="btn sm" href="${esc(certificateUrl(a.id, a.token))}" target="_blank" rel="noopener">證書</a>` : ''}
          <button class="btn danger sm" type="button" data-del-attempt="${esc(a.id)}" data-name="${esc(a.participant.name)}">刪除</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="11" class="muted center">沒有符合條件的紀錄</td></tr>';
  }

  // 匯出 CSV（UTF-8 BOM，Excel 可直接開啟；防範公式注入）
  $('#csvBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const head = ['測驗時間', '課程名稱', '課程類別', '上課日期', '講師', '公司名稱', '單位', '姓名', '職稱', 'E-mail', '得分', '總分', '及格分數', '結果', '證書編號', '作答秒數'];
    const rows = filteredAttempts().map((a) => [
      fmtDateTime(a.createdAt), a.courseName, a.categoryName, a.courseDate, a.instructor, a.participant.company,
      a.participant.dept, a.participant.name, a.participant.title, a.participant.email, a.score, a.total, a.passScore,
      a.passed ? '通過' : '未通過', a.certNo || '', a.durationSec ?? '',
    ]);
    const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `測驗紀錄-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  });

  $('#attemptFilter').addEventListener('submit', (e) => { e.preventDefault(); loadAttempts(true); });
  $('#a_course').addEventListener('change', () => loadAttempts(true));
  $('#a_status').addEventListener('change', () => loadAttempts(true));
  $('#attemptRows').addEventListener('click', async (e) => {
    const id = e.target.dataset.delAttempt;
    if (!id) return;
    if (!confirm(`確定刪除「${e.target.dataset.name}」的測驗紀錄？\n（例如依當事人請求刪除個資；刪除後證書將無法查驗）`)) return;
    const r = await guard(() => api('deleteAttempt', { id }));
    if (r) { toast('已刪除'); loadAttempts(); }
  });

  // ---------------- 類別 ----------------
  async function loadCategories() {
    showView('categories');
    const list = await guard(() => api('categories'));
    if (!list) return;
    categories = list;
    $('#catRows').innerHTML = list.map((c) => `
      <tr><td>${esc(c.name)}</td><td>${c.courseCount}</td>
        <td class="row" style="gap:6px">
          <button class="btn secondary sm" type="button" data-rename="${esc(c.id)}" data-name="${esc(c.name)}">重新命名</button>
          <button class="btn danger sm" type="button" data-del-cat="${esc(c.id)}" data-name="${esc(c.name)}" ${c.courseCount ? 'disabled title="仍有課程使用此類別"' : ''}>刪除</button>
        </td></tr>`).join('');
  }

  $('#catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await guard(() => api('saveCategory', { name: $('#catName').value }));
    if (r) { $('#catName').value = ''; toast('已新增類別'); loadCategories(); }
  });

  $('#catRows').addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.rename) {
      const name = prompt('新的類別名稱', t.dataset.name);
      if (!name) return;
      const r = await guard(() => api('saveCategory', { id: t.dataset.rename, name }));
      if (r) loadCategories();
    }
    if (t.dataset.delCat) {
      if (!confirm(`確定刪除類別「${t.dataset.name}」？`)) return;
      const r = await guard(() => api('deleteCategory', { id: t.dataset.delCat }));
      if (r) loadCategories();
    }
  });

  // ---------------- 設定 ----------------
  const SETTING_KEYS = ['siteName', 'issuer', 'certTitle', 'certPrefix', 'defaultInstructor', 'privacyNotice'];
  async function loadSettings() {
    showView('settings');
    const s = await guard(() => api('getSettings'));
    if (!s) return;
    settings = s;
    SETTING_KEYS.forEach((k) => { $('#s_' + k).value = s[k] || ''; });
  }

  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(SETTING_KEYS.map((k) => [k, $('#s_' + k).value]));
    const r = await guard(() => api('saveSettings', { settings: body }));
    if (r) { toast('設定已儲存'); settings = { ...settings, ...body }; }
  });

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#pw_next').value !== $('#pw_confirm').value) return toast('兩次輸入的新密碼不一致', true);
    const r = await guard(() => api('password', { current: $('#pw_current').value, next: $('#pw_next').value }));
    if (r) {
      toast('密碼已變更');
      $$('#pwForm input').forEach((i) => { i.value = ''; });
      $('#pwWarning').classList.add('hidden');
    }
  });

  start().catch((e) => {
    enterLogin();
    $('#loginError').textContent = e.message;
    $('#loginError').classList.remove('hidden');
  });
})();
