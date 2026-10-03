'use strict';
(async function () {
  let info;
  let courses = [];
  try {
    ({ info, courses } = await api('home'));
    applySiteInfo(info);
  } catch (e) {
    $('#courses').innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
    return;
  }

  const cats = [{ id: '', name: '全部課程' }, ...((info && info.categories) || [])
    .filter((c) => courses.some((x) => x.categoryId === c.id))];
  let current = '';

  function renderTabs() {
    $('#tabs').innerHTML = cats.map((c) =>
      `<button class="tab${c.id === current ? ' active' : ''}" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('');
  }

  function renderCourses() {
    const list = courses.filter((c) => !current || c.categoryId === current);
    if (list.length === 0) {
      $('#courses').innerHTML = '<p class="muted">目前沒有開放測驗的課程。</p>';
      return;
    }
    $('#courses').innerHTML = list.map((c) => `
      <article class="card course-card">
        <div><span class="badge">${esc(c.categoryName)}</span></div>
        <h3>${esc(c.name)}</h3>
        <div class="meta">
          ${c.date ? `<div>上課日期：${esc(fmtDate(c.date))}</div>` : ''}
          <div>講師：${esc(c.instructor)}</div>
          ${c.mode ? `<div>上課方式：${esc(c.mode)}${c.hours ? `　時數：${esc(c.hours)} 小時` : ''}</div>` : ''}
          <div>題數：${c.questionCount} 題　總分 ${c.totalPoints} 分　及格 ${c.passScore} 分</div>
        </div>
        <p class="desc">${esc(c.description)}</p>
        ${safeUrl(c.materialUrl) ? `<a class="btn secondary block material-link" href="${esc(safeUrl(c.materialUrl))}" target="_blank" rel="noopener">📖 課程教材連結</a>` : ''}
        <a class="btn block" href="quiz.html?course=${encodeURIComponent(c.id)}">開始課後測驗</a>
      </article>`).join('');
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    current = b.dataset.id;
    renderTabs();
    renderCourses();
  });

  renderTabs();
  renderCourses();
})();
