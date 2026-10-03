'use strict';
(async function () {
  const qs = new URLSearchParams(location.search);
  let d;
  try {
    d = await api('certificate', { id: qs.get('id') || '', t: qs.get('t') || '' });
  } catch (e) {
    $('#loading').classList.add('hidden');
    $('#error .notice').textContent = e.message;
    $('#error').classList.remove('hidden');
    $('#pngBtn').disabled = true;
    $('#printBtn').disabled = true;
    return;
  }

  $('#loading').classList.add('hidden');
  const p = d.participant;
  const c = d.course;
  const issued = new Date(d.createdAt);
  const issuedText = `${issued.getFullYear()} 年 ${issued.getMonth() + 1} 月 ${issued.getDate()} 日`;
  const verifyUrl = new URL(`verify.html?no=${encodeURIComponent(d.certNo)}`, location.href).href;
  const orgLine = [p.company, p.dept, p.title].filter(Boolean).join('　');
  const courseDetail = [c.date ? `於 ${fmtDate(c.date)}` : '', c.mode ? `參加${c.mode}課程` : '參加'].join(' ');

  document.title = `${d.certTitle} - ${p.name}`;
  $('#cIssuer').textContent = d.issuer;
  $('#cTitle').textContent = d.certTitle;
  $('#cName').textContent = p.name;
  $('#cOrg').textContent = orgLine;
  $('#cBody').innerHTML =
    `${esc(courseDetail)}「<b>${esc(c.name)}</b>」${c.hours ? `（${esc(c.hours)} 小時）` : ''}，` +
    `並通過課後測驗，成績 <b>${d.score}</b> 分（總分 ${d.total} 分，及格 ${d.passScore} 分），特此證明。`;
  $('#cMeta').innerHTML =
    `證書編號：${esc(d.certNo)}<br>課程類別：${esc(c.categoryName)}<br>發證日期：${esc(issuedText)}<br>` +
    `查驗網址：${esc(verifyUrl)}`;
  $('#cInstructor').textContent = c.instructor;

  $('#aMeta').innerHTML =
    `課程：${esc(c.name)}｜學員：${esc(p.company)} ${esc(p.dept)} ${esc(p.name)}（${esc(p.title)}）｜` +
    `成績：${d.score} / ${d.total}（答對 ${d.correctCount} / ${d.questionCount} 題）｜證書編號：${esc(d.certNo)}`;

  $('#answers').innerHTML = d.questions.map((q, n) => {
    const ans = q.answer.map(OPT_LETTER).join('、');
    const given = q.given.length ? q.given.map(OPT_LETTER).join('、') : '未作答';
    const ok = q.given.length === q.answer.length && q.given.every((g) => q.answer.includes(g));
    return `
      <div class="ans-q">
        <div class="qhead"><span class="qno">${n + 1}.</span><span class="qtext">[${TYPE_LABEL[q.type]}] ${esc(q.text)}</span><span class="small muted">${q.points} 分</span></div>
        <ul>${q.options.map((o, i) => {
          const cls = q.answer.includes(i) ? 'correct' : (q.given.includes(i) ? 'wrong-pick' : '');
          return `<li class="${cls}">${q.answer.includes(i) ? '✔' : '　'} ${OPT_LETTER(i)}. ${esc(o)}</li>`;
        }).join('')}</ul>
        <div class="summary">正確答案：<b>${ans}</b>　您的作答：${esc(given)}　${ok ? '<span class="badge ok">正確</span>' : '<span class="badge bad">錯誤</span>'}</div>
        ${q.explanation ? `<div class="explain">解析：${esc(q.explanation)}</div>` : ''}
      </div>`;
  }).join('');

  $('#doc').classList.remove('hidden');
  $('#printBtn').addEventListener('click', () => window.print());
  $('#pngBtn').addEventListener('click', downloadPng);

  // 以 Canvas 繪製證書圖片（A4 橫式，150 dpi）
  function downloadPng() {
    const W = 1754, H = 1240;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const SANS = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    const SERIF = '"Noto Serif TC","PMingLiU","Songti TC",serif';
    const NAVY = '#1f4e79', GOLD = '#b8860b';

    x.fillStyle = '#fffdf7'; x.fillRect(0, 0, W, H);
    x.strokeStyle = NAVY; x.lineWidth = 10; x.strokeRect(40, 40, W - 80, H - 80);
    x.lineWidth = 2; x.strokeRect(58, 58, W - 116, H - 116);
    x.strokeStyle = GOLD; x.lineWidth = 2; x.strokeRect(72, 72, W - 144, H - 144);

    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    const cx = W / 2;
    x.fillStyle = NAVY; x.font = `700 34px ${SANS}`; x.fillText(spaced(d.issuer, 0.15), cx, 175);
    x.font = `700 84px ${SERIF}`; x.fillText(spaced(d.certTitle, 0.3), cx, 290);
    x.fillStyle = GOLD; x.font = `500 26px ${SANS}`; x.fillText('C E R T I F I C A T E   O F   C O M P L E T I O N', cx, 340);
    x.fillStyle = '#444'; x.font = `32px ${SANS}`; x.fillText('茲證明', cx, 420);
    x.fillStyle = '#111'; x.font = `700 76px ${SERIF}`; x.fillText(p.name, cx, 515);
    const nw = Math.max(360, x.measureText(p.name).width + 140);
    x.strokeStyle = GOLD; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - nw / 2, 538); x.lineTo(cx + nw / 2, 538); x.stroke();
    x.fillStyle = '#333'; x.font = `30px ${SANS}`; x.fillText(orgLine, cx, 590);

    const body = `${courseDetail}「${c.name}」${c.hours ? `（${c.hours} 小時）` : ''}，並通過課後測驗，` +
      `成績 ${d.score} 分（總分 ${d.total} 分，及格 ${d.passScore} 分），特此證明。`;
    x.fillStyle = '#222'; x.font = `33px ${SANS}`;
    wrap(x, body, 1300).forEach((line, i) => x.fillText(line, cx, 670 + i * 58));

    x.textAlign = 'left'; x.fillStyle = '#444'; x.font = `24px ${SANS}`;
    [`證書編號：${d.certNo}`, `課程類別：${c.categoryName}`, `發證日期：${issuedText}`, `查驗網址：${verifyUrl}`]
      .forEach((t, i) => {
        // 長網址自動縮小字級，避免與講師簽名區重疊
        for (let size = 24; size >= 14; size--) {
          x.font = `${size}px ${SANS}`;
          if (x.measureText(t).width <= 1000) break;
        }
        x.fillText(t, 150, 1000 + i * 38);
      });

    x.textAlign = 'center'; x.fillStyle = '#111'; x.font = `700 40px ${SERIF}`;
    x.fillText(c.instructor, 1380, 1060);
    x.strokeStyle = '#333'; x.lineWidth = 2; x.beginPath(); x.moveTo(1190, 1080); x.lineTo(1570, 1080); x.stroke();
    x.fillStyle = '#444'; x.font = `24px ${SANS}`; x.fillText('課程講師', 1380, 1115);

    cv.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${d.certNo}_${p.name}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, 'image/png');
  }

  function spaced(s, ratio) {
    return ratio >= 0.25 ? Array.from(s).join(' ') : Array.from(s).join(' ');
  }

  function wrap(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const ch of Array.from(text)) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }
})();
