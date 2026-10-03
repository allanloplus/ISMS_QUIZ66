'use strict';
(function () {
  loadSiteInfo();
  async function check(no) {
    const out = $('#result');
    try {
      const r = await api(`/api/public/verify/${encodeURIComponent(no.trim())}`);
      out.innerHTML = r.valid
        ? `<div class="notice info"><span class="badge ok">有效證書</span>
            <table class="data" style="margin-top:10px">
              <tr><th>證書編號</th><td>${esc(r.certNo)}</td></tr>
              <tr><th>姓名</th><td>${esc(r.name)}</td></tr>
              <tr><th>課程名稱</th><td>${esc(r.courseName)}</td></tr>
              <tr><th>上課日期</th><td>${esc(fmtDate(r.courseDate))}</td></tr>
              <tr><th>測驗成績</th><td>${r.score} / ${r.total}</td></tr>
              <tr><th>發證時間</th><td>${esc(fmtDateTime(r.issuedAt))}</td></tr>
            </table></div>`
        : '<div class="notice error">查無此證書編號，請確認輸入是否正確。</div>';
    } catch (e) {
      out.innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
    }
  }
  $('#form').addEventListener('submit', (e) => { e.preventDefault(); check($('#no').value); });
  const no = new URLSearchParams(location.search).get('no');
  if (no) { $('#no').value = no; check(no); }
})();
