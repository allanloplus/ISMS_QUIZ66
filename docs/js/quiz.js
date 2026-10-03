'use strict';
(async function () {
  const courseId = new URLSearchParams(location.search).get('course');
  const FIELDS = ['company', 'dept', 'name', 'title', 'email'];
  const STORE_KEY = 'isms-quiz-participant';
  let data;
  let startedAt = null;

  try {
    if (!courseId) throw new Error('未指定課程，請回首頁選擇課程。');
    data = await api('quiz', { courseId });
  } catch (e) {
    $('#loadError').innerHTML = `${esc(e.message)}　<a href="./">回課程列表</a>`;
    $('#loadError').classList.remove('hidden');
    $('#loading').classList.add('hidden');
    return;
  }
  const info = data.info;
  applySiteInfo(info);
  $('#loading').classList.add('hidden');
  const c = data.course;
  document.title = `${c.name} - 課後測驗`;

  $('#courseInfo').innerHTML = `
    <span class="badge">${esc(c.categoryName)}</span>
    <h1 style="margin-top:8px">${esc(c.name)}</h1>
    <div class="muted small">
      ${c.date ? `上課日期：${esc(fmtDate(c.date))}　` : ''}講師：${esc(c.instructor)}
      ${c.mode ? `　上課方式：${esc(c.mode)}` : ''}${c.hours ? `　時數：${esc(c.hours)} 小時` : ''}
    </div>
    <div class="notice info" style="margin-top:12px">本測驗共 <b>${c.questionCount}</b> 題，總分 <b>${c.totalPoints}</b> 分，達 <b>${c.passScore}</b> 分（含）以上即為通過。複選題須全部答對才給分。</div>`;
  $('#courseInfo').classList.remove('hidden');

  $('#privacy').textContent = (info && info.privacyNotice) || '';

  // 預填（同一瀏覽器分頁內重新測驗時免重複輸入）
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}');
    FIELDS.forEach((f) => { if (saved[f]) $('#' + f).value = saved[f]; });
  } catch (e) { /* ignore */ }

  function show(id) {
    ['stepInfo', 'stepQuiz', 'stepResult'].forEach((s) => $('#' + s).classList.toggle('hidden', s !== id));
    window.scrollTo({ top: 0 });
  }

  function participant() {
    return Object.fromEntries(FIELDS.map((f) => [f, $('#' + f).value.trim()]));
  }

  function renderQuestions() {
    $('#questions').innerHTML = data.questions.map((q, n) => {
      const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
      return `
        <div class="question" data-qid="${esc(q.id)}">
          <div class="qhead"><span class="qno">${n + 1}.</span><span class="qtext">${esc(q.text)}</span>
            <span class="qpts">${TYPE_LABEL[q.type]}｜${q.points} 分</span></div>
          <ul class="options">
            ${q.options.map((o, k) => `
              <li><label><input type="${inputType}" name="q_${esc(q.id)}" value="${o.i}"><span>${OPT_LETTER(k)}. ${esc(o.text)}</span></label></li>`).join('')}
          </ul>
        </div>`;
    }).join('');
    updateProgress();
  }

  function collectAnswers() {
    const answers = {};
    data.questions.forEach((q) => {
      answers[q.id] = $$(`input[name="q_${CSS.escape(q.id)}"]:checked`).map((el) => Number(el.value));
    });
    return answers;
  }

  function updateProgress() {
    const a = collectAnswers();
    const done = Object.values(a).filter((v) => v.length > 0).length;
    $('#progressText').textContent = `已作答 ${done} / ${data.questions.length} 題`;
    $('#progressBar').style.width = `${(done / data.questions.length) * 100}%`;
  }

  $('#stepInfo').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = participant();
    const labels = { company: '公司名稱', dept: '單位', name: '姓名', title: '職稱', email: 'E-mail' };
    const missing = FIELDS.filter((f) => !p[f]).map((f) => labels[f]);
    let err = '';
    if (missing.length) err = `請填寫：${missing.join('、')}`;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) err = 'E-mail 格式不正確';
    else if (!$('#consent').checked) err = '請勾選同意個人資料蒐集告知事項';
    $('#infoError').textContent = err;
    $('#infoError').classList.toggle('hidden', !err);
    if (err) return;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e2) { /* ignore */ }
    $('#whoText').textContent = `${p.company}｜${p.name}`;
    if (!startedAt) {
      startedAt = new Date().toISOString();
      renderQuestions();
    }
    show('stepQuiz');
  });

  $('#backToInfo').addEventListener('click', () => show('stepInfo'));
  $('#questions').addEventListener('change', updateProgress);

  $('#stepQuiz').addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = collectAnswers();
    const unanswered = data.questions.map((q, n) => (answers[q.id].length ? null : n + 1)).filter(Boolean);
    if (unanswered.length && !confirm(`尚有第 ${unanswered.join('、')} 題未作答，確定要交卷嗎？`)) return;
    if (!unanswered.length && !confirm('確定要交卷嗎？交卷後將無法修改答案。')) return;
    $('#submitBtn').disabled = true;
    $('#submitBtn').textContent = '評分中…';
    $('#quizError').classList.add('hidden');
    try {
      const r = await api('submit', { courseId, participant: participant(), consent: true, answers, startedAt });
      renderResult(r);
    } catch (err) {
      $('#quizError').textContent = err.message;
      $('#quizError').classList.remove('hidden');
    } finally {
      $('#submitBtn').disabled = false;
      $('#submitBtn').textContent = '交卷';
    }
  });

  function renderResult(r) {
    const el = $('#stepResult');
    if (r.passed) {
      el.innerHTML = `
        <div class="result-box pass">
          <span class="badge ok">測驗通過</span>
          <div class="score">${r.score} <span class="small muted">/ ${r.total} 分</span></div>
          <p>恭喜您通過「${esc(c.name)}」課後測驗！（答對 ${r.correctCount} / ${r.questionCount} 題，及格分數 ${r.passScore} 分）</p>
          <p class="muted small">證書編號：<b>${esc(r.certNo)}</b><br>請下載並妥善保存您的合格證書；證書頁面附有本次測驗題目與解答。</p>
          <div class="actions">
            <a class="btn" href="${esc(certificateUrl(r.attemptId, r.token))}" target="_blank" rel="noopener">檢視／下載合格證書</a>
            <a class="btn secondary" href="./">回課程列表</a>
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="result-box fail">
          <span class="badge bad">未通過</span>
          <div class="score">${r.score} <span class="small muted">/ ${r.total} 分</span></div>
          <p>很遺憾，本次測驗未達及格分數 <b>${r.passScore}</b> 分（答對 ${r.correctCount} / ${r.questionCount} 題）。</p>
          <div class="notice" style="text-align:left;margin:16px auto;max-width:560px">
            請依下列方式再次準備後重新測驗：
            <ol style="margin:8px 0 0;padding-left:1.4em">
              <li>重新參加課程（實體或線上），或重新閱讀課程教材。</li>
              <li>複習後回到本頁面重新測驗，直到通過為止。</li>
            </ol>
          </div>
          <div class="actions">
            ${r.materialUrl ? `<a class="btn secondary" href="${esc(r.materialUrl)}" target="_blank" rel="noopener">重新閱讀課程教材</a>` : ''}
            <button class="btn" type="button" id="retryBtn">重新測驗</button>
            <a class="btn secondary" href="./">回課程列表</a>
          </div>
        </div>`;
      $('#retryBtn').addEventListener('click', async () => {
        // 重新取題（若有設定亂序，題目順序會重新排列）
        $('#retryBtn').disabled = true;
        try {
          data = await api('quiz', { courseId });
        } catch (err) {
          $('#retryBtn').disabled = false;
          toast(err.message, true);
          return;
        }
        startedAt = new Date().toISOString();
        renderQuestions();
        show('stepQuiz');
      });
    }
    show('stepResult');
  }

  show('stepInfo');
})();
