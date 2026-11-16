/* 한 표(가칭) 디자인 가안 목업. 화면 구성은 공통이고 시그니처 연출은 테마(a/b/c)가 정한다. */
(() => {
  const T = document.documentElement.dataset.theme;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICONS = {
    pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
    eraser: '<path d="M8 20h11"/><path d="M5.2 15.2L14 6.4a2 2 0 012.8 0l2.8 2.8a2 2 0 010 2.8L11.6 20H8l-2.8-2.8a2 2 0 010-2z"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a5 5 0 010 9h-3"/>',
    trash: '<path d="M5 7h14"/><path d="M10 7V4h4v3"/><path d="M7 7l1 13h8l1-13"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    eyeoff: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4 4l16 16"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    users: '<path d="M16 20v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1"/><circle cx="10" cy="8" r="3.4"/><path d="M20 20v-1a3.5 3.5 0 00-3-3.4M15.5 4.4a3.4 3.4 0 010 6.4"/>',
    cover: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  };
  const ic = (n, s = 20, sw = 1.9) =>
    `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  const NAMES = ['하늘','민준','서연','지후','도윤','예은','시우','하린','주원','채원','지안','이안','유나','준서','소율','현우','나은','태오','다온','건우','수아','로운','가온','은우','세아','윤호','지민','재이','아린','단우','해든','나래','보람','시현','예준','라온','한결','새봄','도하','이레','우진','설아','찬영','미르','다인'];
  const DONE = 32;
  const BALLOTS = [
    { t: '서연이요!\n발표 자료 같이\n만들어 줘서\n정말 고마웠어요', by: '하늘' },
    { t: '민준이가\n맨날 청소를\n먼저 해요.\n이번 달 MVP!', by: '지후' },
    { t: '도윤!\n팀 분위기\n메이커라서요', by: '예은' },
    { t: '저는 저요 ㅎㅎ\n이번 달 진짜\n열심히 했음', by: '시우' },
    { t: '하린님.\n질문할 때마다\n친절하게 알려\n주셔서 감사해요', by: '주원' },
  ];
  const OPTIONS = [['돈가스', 13], ['김치찜', 10], ['비빔밥', 6], ['샐러드', 3]];

  /* ---------- 가짜 QR (모양만 흉내, 스캔 안 됨) ---------- */
  function qr() {
    const N = 25; let s = 4827; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const g = Array.from({ length: N }, () => Array.from({ length: N }, () => rnd() > 0.5));
    const finder = (x, y) => {
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
        const edge = i === 0 || i === 6 || j === 0 || j === 6, core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        g[Y][X] = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (edge || core);
      }
    };
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    let r = '';
    g.forEach((row, y) => row.forEach((on, x) => { if (on) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`; }));
    return `<svg viewBox="0 0 ${N} ${N}" fill="#111" aria-label="입장용 QR (목업)">${r}</svg>`;
  }

  /* ---------- 공통 조각 ---------- */
  const sb = '<div class="sb"></div>';
  const badge = (name = '하늘') =>
    `<div class="badge"><span class="when-anon">${ic('eyeoff', 18)}공개 화면에 이름이 표시되지 않아요</span><span class="when-named">${ic('pen', 18)}공개 화면에 ‘${name}’ 이름이 표시돼요</span></div>`;
  const phone = (inner) => `<div class="phone"><div class="screen">${sb}${inner}</div></div>`;
  const fig = (cap, html) => `<figure>${html}<figcaption>${cap}</figcaption></figure>`;
  const seg = (name, items, checked = 0) =>
    `<div class="seg" role="radiogroup">${items.map((l, i) => `<label><input type="radio" name="${name}" value="${i}" ${i === checked ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const sw = (title, desc, on = false) =>
    `<div class="sw"><div><b>${title}</b><small>${desc}</small></div><button class="switch" role="switch" aria-checked="${on}" aria-label="${title}"></button></div>`;

  /* ---------- 참가자 ---------- */
  const p1 = () => phone(`
    <div class="appbar"><span class="logo">한 표</span><span class="pill">참가자</span></div>
    <div class="body" style="gap:18px">
      <div class="stack" style="margin-top:14px"><h3 class="title">방 코드를<br>입력하세요</h3><p class="sub">운영자 화면의 QR을 찍으면 자동으로 입력돼요.</p></div>
      <div class="field"><span class="lbl">방 코드</span>
        <div class="code" role="group" aria-label="방 코드 4자리">${['4','8','2','7'].map((d, i) => `<input inputmode="numeric" maxlength="1" value="${d}" aria-label="${i + 1}번째 숫자">`).join('')}</div></div>
      <div class="field"><label for="nick-${T}">닉네임</label><input id="nick-${T}" class="input" value="하늘" maxlength="8"></div>
      <p class="hint">입장하면 같은 방 사람들에게 닉네임이 보여요. 방 안에서 닉네임은 겹칠 수 없어요.</p>
      <div style="flex:1"></div>
      <button class="btn wide">입장하기</button>
    </div>`);

  const p2 = () => phone(`
    <div class="appbar"><span class="pill">${ic('users', 16)}방 4827 · 하늘</span><span class="hint" style="font-weight:600">작성 중</span></div>
    <div class="body" style="gap:10px;padding-top:2px">
      <h3 class="title" style="font-size:23px">이번 달 MVP는<br>누구인가요?</h3>
      ${badge()}
      ${seg('mode-' + T, ['쓰기', '타이핑'])}
      <div class="paper" data-draw>
        <div data-pane="write" style="position:absolute;inset:0"><canvas aria-label="손글씨 용지"></canvas></div>
        <div data-pane="type" hidden style="position:absolute;inset:0"><textarea maxlength="200" placeholder="여기에 적어 주세요" aria-label="타이핑 용지"></textarea><span class="count">0 / 200</span></div>
        <div class="sig">— 하늘</div>
      </div>
      <div class="tools" data-tools>
        <button class="tool" data-tool="pen" aria-pressed="true" aria-label="펜">${ic('pen')}</button>
        <button class="tool" data-tool="pen2" aria-pressed="false" aria-label="굵은 펜">${ic('pen', 20, 3.2)}</button>
        <button class="tool" data-tool="eraser" aria-pressed="false" aria-label="지우개">${ic('eraser')}</button>
        <span class="gap"></span>
        <button class="tool plain" data-act="undo" aria-label="되돌리기">${ic('undo')}</button>
        <button class="tool plain" data-act="clear" aria-label="전체 지우기">${ic('trash')}</button>
      </div>
      <button class="btn wide" style="margin-top:auto">접어서 넣기</button>
    </div>`);

  const ringPath = 'M14 30C3 14 50 4 104 4C160 4 198 12 194 28C190 46 140 50 100 50C48 50 8 46 6 28C5 16 30 8 62 6';
  const p3 = () => phone(`
    <div class="appbar"><span class="pill">${ic('users', 16)}방 4827 · 하늘</span><span class="hint" style="font-weight:600">작성 중</span></div>
    <div class="body" style="gap:10px;padding-top:2px">
      <h3 class="title" style="font-size:23px">오늘 점심은<br>뭐가 좋을까요?</h3>
      ${badge()}
      <p class="hint">하나를 골라 동그라미를 쳐 주세요.</p>
      <div class="paper" data-opts role="radiogroup" aria-label="보기">
        <div class="opts">${['김치찜', '돈가스', '비빔밥', '샐러드'].map((o, i) => `
          <button class="opt" role="radio" aria-checked="${i === 1}" data-i="${i}">${o}<svg class="ring" viewBox="0 0 200 54" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="${ringPath}"/></svg></button>`).join('')}</div>
        <div class="sig">— 하늘</div>
      </div>
      <button class="btn wide" style="margin-top:auto">접어서 넣기</button>
    </div>`);

  const stageHTML = () => `
    <div class="stage" data-stage>
      <div class="pp">
        <div class="bot"><div class="mini">서연이요!<br>발표 자료 같이<br>만들어 줘서<br>정말 고마웠어요</div></div>
        <div class="top"><div class="face"><div class="mini">서연이요!<br>발표 자료 같이<br>만들어 줘서<br>정말 고마웠어요</div></div><div class="back back-side"><i class="crease-h"></i></div></div>
      </div>
      <div class="fold2"><div class="r back-side"><i class="crease-v"></i></div><div class="l"><i class="back-side"></i><i class="back-side"></i></div></div>
      <div class="slip back-side"><i class="crease-v"></i></div>
      <div class="box"><div class="lid"><i class="slot"></i></div><div class="front"><span class="plate">투표함 <b data-count>27</b></span></div></div>
    </div>`;
  const p4 = () => phone(`
    <div class="appbar"><span class="pill">${ic('users', 16)}방 4827 · 하늘</span></div>
    <div class="body p4" style="gap:6px">
      <h3 class="title" style="font-size:23px">이 용지를 넣을까요?</h3>
      <p class="hint">제출하면 고칠 수 없어요.</p>
      ${stageHTML()}
      <p class="status" aria-live="polite"></p>
      <div class="actions"><button class="btn ghost" data-back>돌아가기</button><button class="btn" data-go>제출하기</button></div>
    </div>`);

  /* ---------- 운영자 ---------- */
  const o1 = () => phone(`
    <div class="appbar"><span class="pill">${ic('users', 16)}방 4827 · 45명</span><span class="hint" style="font-weight:600">운영자</span></div>
    <div class="body" style="gap:12px;padding-top:2px">
      <h3 class="title" style="font-size:23px">새 투표 만들기</h3>
      <div class="field"><label for="vt-${T}">투표 제목</label><input id="vt-${T}" class="input" value="오늘 점심은 뭐가 좋을까요?"></div>
      <div><span class="lbl">용지 유형</span>${seg('kind-' + T, ['자유 기재', '객관식'], 1)}</div>
      <div><span class="lbl">공개 방식</span>${seg('anon-' + T, ['익명', '기명'])}
        <p class="hint" style="margin-top:8px">익명이면 공개 화면에 이름이 나오지 않아요. 운영자는 작성자를 볼 수 있어요.</p></div>
      <div class="panel stack" style="gap:8px">
        <span class="lbl" style="margin:0">보기 (2~8개)</span>
        ${['김치찜', '돈가스', '비빔밥', '샐러드'].map((o, i) => `<div class="opt-edit"><input class="input" value="${o}" aria-label="보기 ${i + 1}"><button class="tool plain" aria-label="보기 삭제" style="color:var(--panel-ink)">${ic('x', 18)}</button></div>`).join('')}
        <button class="btn ghost sm" style="color:var(--panel-ink);--ghost-line:var(--panel-line)">${ic('plus', 18)}보기 추가</button>
      </div>
    </div>
    <div class="bar-bottom"><button class="btn">투표 시작</button></div>`);

  const o2 = () => phone(`
    <div class="appbar"><span class="pill">${ic('users', 16)}방 4827</span><span class="hint" style="font-weight:600">투표 진행 중</span></div>
    <div class="body" style="gap:12px;padding-top:2px">
      <div><h3 class="title" style="font-size:23px">오늘 점심은 뭐가 좋을까요?</h3><p class="sub" style="margin-top:4px"><b>32</b> / 45명 제출 · <span class="when-anon">익명</span><span class="when-named">기명</span></p></div>
      <div class="roll panel">
        <h4>아직 안 냈어요 <b>${45 - DONE}</b></h4>
        <ul class="names todo">${NAMES.slice(DONE).map((n) => `<li>${n}</li>`).join('')}</ul>
        <h4 style="margin-top:14px">제출했어요 <b>${DONE}</b></h4>
        <ul class="names done">${NAMES.slice(0, DONE).map((n) => `<li>${n}</li>`).join('')}</ul>
      </div>
      <div class="panel">
        ${sw('대화면 가리기', '대화면에는 접힌 용지만 보여요')}
        <div class="when-anon">${sw('작성자 보기', '익명 투표에서도 이 화면에만 보여요')}</div>
      </div>
    </div>
    <div class="bar-bottom"><button class="btn ghost">대화면 열기</button><button class="btn">마감하기</button></div>`);

  /* ---------- 대화면 ---------- */
  const s1 = () => `
    <div class="big s1"><div class="big-in">
      <div class="left">
        <h3 class="t t-xl">한 표</h3>
        <p class="t t-m muted" style="font-family:var(--f-ui);font-weight:600">QR을 찍거나 코드를 입력하세요</p>
        <div class="join"><div class="qr">${qr()}</div>
          <div><div class="codebox">${['4','8','2','7'].map((d) => `<b>${d}</b>`).join('')}</div>
          <p class="muted" style="font-size:1.5cqw;margin-top:1cqw">hanpyo.example</p></div></div>
      </div>
      <div class="right"><div class="t t-l">45명 입장 <span class="muted" style="font-size:.6em;font-family:var(--f-ui);font-weight:600">운영자가 투표를 만들고 있어요</span></div>
        <ul class="chips">${NAMES.map((n) => `<li>${n}</li>`).join('')}</ul></div>
    </div></div>`;

  const s2 = () => `
    <div class="big s2" data-reveal><div class="big-in">
      <div class="top"><span class="t t-l">이번 달 MVP는?</span><span class="muted" style="font-size:1.6cqw;font-weight:700">자유 기재 · <span class="when-anon">익명</span><span class="when-named">기명</span></span></div>
      <div class="pile" aria-hidden="true"><i></i><i></i><i></i><small>남은 용지 25장</small></div>
      <div class="reveal"><div class="ballot-big" data-ballot><span data-text></span><span class="sig"></span><i class="crease h"></i><i class="crease v"></i></div></div>
      <div class="ctrl">
        <button class="bigbtn ghost" data-prev>${ic('left')}이전</button>
        <output aria-live="polite" data-num>7 / 32</output>
        <button class="bigbtn" data-next>다음 용지${ic('right')}</button>
        <button class="bigbtn ghost" aria-label="전체화면">${ic('full')}</button>
      </div>
    </div></div>`;

  const tally = (n) => {
    const full = Math.floor(n / 5), rest = n % 5; const strokes = ['M4 7H36', 'M20 7V35', 'M20 21H31', 'M10 21V35', 'M4 37H36'];
    const one = (k, cls) => `<svg viewBox="0 0 40 44" class="z ${cls || ''}" aria-hidden="true">${strokes.slice(0, k).map((d) => `<path d="${d}"/>`).join('')}</svg>`;
    return Array.from({ length: full }, () => one(5)).join('') + (rest ? one(rest) : '');
  };
  const graph = () => {
    const max = Math.max(...OPTIONS.map((o) => o[1]));
    if (T === 'a') return `<div class="g-a">${OPTIONS.map(([l, n], i) => `<div class="r ${i === 0 ? 'win' : ''}"><span class="l">${l}</span><div class="bar" style="--w:${(n / max) * 100}%"></div><b>${n}</b></div>`).join('')}</div>`;
    if (T === 'b') return `<div class="g-b">${OPTIONS.map(([l, n], i) => `<div class="c c${i}" style="--h:${(n / max) * 100}%"><b>${n}</b><div class="bar"></div><span>${l}</span></div>`).join('')}</div>`;
    return `<div class="g-c">${OPTIONS.map(([l, n], i) => `<div class="r ${i === 0 ? 'win' : ''}"><span class="l">${l}</span><div class="tl">${tally(n)}</div><b>${n}</b></div>`).join('')}</div>`;
  };
  const s3 = () => `
    <div class="big s3"><div class="big-in">
      <div class="top" style="display:flex;justify-content:space-between;align-items:baseline"><span class="t t-l">오늘 점심은 뭐가 좋을까요?</span><span class="muted" style="font-size:1.6cqw;font-weight:700">32명 참여 · 전체 공개</span></div>
      ${graph()}
      <div class="ctrl"><button class="bigbtn ghost">${ic('left')}다시 한 장씩 보기</button><button class="bigbtn ghost" aria-label="전체화면">${ic('full')}</button></div>
    </div></div>`;

  /* ---------- 조립 ---------- */
  const g = $('#groups');
  g.innerHTML = `
    <section class="group"><h2>참가자 폰</h2><p>폰 세로 화면. 입장, 쓰기와 타이핑 용지, 객관식 용지, 제출 연출입니다. 용지는 직접 써 보고 눌러 볼 수 있어요.</p>
      <div class="row">${fig('입장: 코드와 닉네임만', p1())}${fig('자유 기재: 쓰기와 타이핑 전환', p2())}${fig('객관식: 탭하면 동그라미', p3())}${fig('제출: 접어서 투표함에 넣기', p4())}</div></section>
    <section class="group"><h2>운영자 폰</h2><p>투표 만들기와 진행 현황입니다. 진행 현황에서는 미제출자 이름을 운영자만 봅니다.</p>
      <div class="row">${fig('투표 만들기', o1())}${fig('진행 현황과 마감', o2())}</div></section>
    <section class="group"><h2>대화면</h2><p>16:9 가로 화면. 운영자 폰으로 진행하고 큰 화면에 보여주는 보기 전용 화면입니다.</p>
      <div class="bigs">${fig('대기실: 입장 QR과 참가자', s1())}${fig('한 장씩 펼치기: 방향키 또는 버튼으로 넘겨 보세요', s2())}${fig('객관식 전체 공개: 그래프', s3())}</div></section>`;

  /* ---------- 익명/기명 ---------- */
  document.body.dataset.anon = 'true';
  $$('input[name="anon-head"]').forEach((r) => r.addEventListener('change', () => { document.body.dataset.anon = r.value === '0' ? 'true' : 'false'; }));
  $$('[role="switch"]').forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true')));

  /* ---------- 쓰기/타이핑 용지 ---------- */
  function initDraw(paper) {
    const cv = $('canvas', paper), ctx = cv.getContext('2d');
    let strokes = [], cur = null, tool = 'pen', base = true, W = 0, H = 0;
    const fit = () => {
      const r = paper.getBoundingClientRect(); W = paper.clientWidth; H = paper.clientHeight; const d = devicePixelRatio || 1;
      cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(d, 0, 0, d, 0, 0); redraw();
    };
    const sample = () => {
      ctx.save(); ctx.fillStyle = getComputedStyle(paper).getPropertyValue('--paper-ink') || '#1d2330';
      ctx.font = '31px "Nanum Pen Script", cursive'; ctx.textBaseline = 'alphabetic';
      ['서연이요!', '발표 자료 같이', '만들어 줘서', '정말 고마웠어요'].forEach((t, i) => ctx.fillText(t, 16, 46 + i * 32));
      ctx.restore();
    };
    const line = (s) => {
      ctx.save(); ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = s.w; ctx.strokeStyle = '#1d2330'; ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + .1, s.pts[0][1]); ctx.stroke(); ctx.restore();
    };
    const redraw = () => { ctx.clearRect(0, 0, W, H); if (base) sample(); strokes.forEach(line); };
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); cur = { pts: [pt(e)], w: tool === 'pen2' ? 5 : tool === 'eraser' ? 22 : 2.6, erase: tool === 'eraser' }; strokes.push(cur); redraw(); });
    cv.addEventListener('pointermove', (e) => { if (!cur) return; cur.pts.push(pt(e)); redraw(); });
    ['pointerup', 'pointercancel'].forEach((ev) => cv.addEventListener(ev, () => { cur = null; }));
    const tools = $('[data-tools]', paper.parentElement);
    $$('[data-tool]', tools).forEach((b) => b.addEventListener('click', () => { tool = b.dataset.tool; $$('[data-tool]', tools).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
    $('[data-act="undo"]', tools).addEventListener('click', () => { strokes.pop(); redraw(); });
    $('[data-act="clear"]', tools).addEventListener('click', () => { strokes = []; base = false; redraw(); });
    new ResizeObserver(fit).observe(paper); document.fonts.load('31px "Nanum Pen Script"').then(fit);
    const ta = $('textarea', paper), cnt = $('.count', paper); ta.addEventListener('input', () => { cnt.textContent = `${ta.value.length} / 200`; });
    const radios = $$('input[type="radio"]', paper.parentElement);
    radios.forEach((r) => r.addEventListener('change', () => {
      const typing = r.value === '1' && r.checked; $('[data-pane="write"]', paper).hidden = typing; $('[data-pane="type"]', paper).hidden = !typing; tools.style.visibility = typing ? 'hidden' : 'visible';
    }));
  }
  const dp = $('[data-draw]'); if (dp) initDraw(dp);

  /* ---------- 객관식 동그라미 ---------- */
  $$('[data-opts] .opt').forEach((b) => b.addEventListener('click', () => { $$('[data-opts] .opt').forEach((x) => x.setAttribute('aria-checked', x === b)); }));

  /* ---------- 접기 연출 ---------- */
  const stage = $('[data-stage]'); let playing = false;
  async function play() {
    if (playing) return; playing = true;
    const s = $('.status'), go = $('[data-go]'), count = $('[data-count]');
    stage.classList.remove('st2', 'st3'); stage.querySelectorAll('.top,.l,.slip').forEach((e) => e.getAnimations().forEach((a) => a.cancel()));
    count.textContent = '27'; s.textContent = ''; go.disabled = true;
    const top = $('.top', stage), l = $('.l', stage), slip = $('.slip', stage), box = $('.box', stage);
    if (reduce) { stage.classList.add('st3'); slip.style.opacity = '0'; await wait(200); }
    else {
      const ease = 'cubic-bezier(.45,0,.2,1)';
      await wait(400);
      await top.animate([{ transform: 'rotateX(0)' }, { transform: 'rotateX(-180deg)' }], { duration: 800, easing: ease, fill: 'forwards' }).finished;
      stage.classList.add('st2');
      await l.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(180deg)' }], { duration: 700, easing: ease, fill: 'forwards' }).finished;
      stage.classList.add('st3');
      await slip.animate([
        { transform: 'translate(0,0) rotate(0)' },
        { transform: 'translate(-38px,-10px) rotate(-5deg) scale(.95)', offset: .3, easing: ease },
        { transform: 'translate(-38px,22px) rotate(0) scale(.9)', offset: .55 },
        { transform: 'translate(-38px,172px) rotate(0) scale(.9)', easing: 'cubic-bezier(.5,0,.9,.6)' },
      ], { duration: 1200, fill: 'forwards' }).finished;
      box.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(4px) scale(1.02,.97)' }, { transform: 'translateY(0) scale(1)' }], { duration: 320, easing: 'ease-out' });
    }
    count.textContent = '28'; navigator.vibrate && navigator.vibrate(30);
    s.textContent = '투표함에 넣었어요. 진동이 짧게 울려요.'; go.disabled = false; go.textContent = '다시 보기'; playing = false;
  }
  if (stage) {
    $('[data-go]').addEventListener('click', play);
    new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { o.disconnect(); play(); } }, { threshold: .7 }).observe(stage);
  }

  /* ---------- 한 장씩 펼치기 ---------- */
  const rev = $('[data-reveal]');
  if (rev) {
    let i = 0; const b = $('[data-ballot]', rev), tx = $('[data-text]', b), sg = $('.sig', b), num = $('[data-num]', rev);
    const show = (n, anim) => {
      i = (n + BALLOTS.length) % BALLOTS.length; tx.textContent = BALLOTS[i].t; sg.textContent = '— ' + BALLOTS[i].by; num.textContent = `${7 + i} / 32`;
      if (anim && !reduce) {
        b.animate([{ clipPath: 'inset(46% 28% 46% 28% round 4px)', transform: 'scale(.7) rotateX(26deg)', opacity: .85 }, { clipPath: 'inset(0 0 0 0 round 4px)', transform: 'scale(1) rotateX(0)', opacity: 1 }], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' });
        $$('.crease', b).forEach((c) => c.animate([{ opacity: .9 }, { opacity: .25 }], { duration: 1000 }));
      }
    };
    show(0, false);
    $('[data-next]', rev).addEventListener('click', () => show(i + 1, true));
    $('[data-prev]', rev).addEventListener('click', () => show(i - 1, true));
    document.addEventListener('keydown', (e) => { if (e.target.closest('input,textarea')) return; if (e.key === 'ArrowRight') show(i + 1, true); if (e.key === 'ArrowLeft') show(i - 1, true); });
  }
})();
