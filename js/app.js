(() => {
  const BOOT_AT = (window.performance && performance.now) ? performance.now() : Date.now();
  const SCHOOL = window.MI_SCHOOL || {};
  const DEVICE_KEY = `mi_device_token_${SCHOOL.code || 'school'}`;
  const PENDING_KEY = `mi_pending_mood_${SCHOOL.code || 'school'}`;
  const STAFF_SESSION_KEY = `mi_staff_session_${SCHOOL.code || 'school'}`;

  const S = {
    bridgePromise: null,
    deviceToken: '',
    rememberDevice: true,
    user: null,
    currentRecordId: '',
    currentMoodCode: '',
    reasonCode: '',
    reasonText: '',
    helpWish: '',
    authVerified: false,
    lastAuthTotalMs: 0,
    lastAuthServerMs: 0,
    lastAuthCacheHit: false,
    staffSession: '',
    staffUser: null,
    staffDashboard: null
  };

  const MOODS = [
    { code: 'GOOD', emoji: '😊', label: '좋아요', followup: false },
    { code: 'OK', emoji: '🙂', label: '괜찮아요', followup: false },
    { code: 'SO_SO', emoji: '😐', label: '그냥 그래요', followup: false },
    { code: 'HARD', emoji: '😟', label: '힘들어요', followup: true },
    { code: 'VERY_HARD', emoji: '😢', label: '많이 힘들어요', followup: true }
  ];

  const REASONS = [
    ['SCHOOL', '학교생활'], ['FRIEND', '친구'], ['STUDY', '공부'], ['FAMILY', '가족'],
    ['HEALTH', '건강'], ['CAREER', '진로'], ['UNKNOWN', '잘 모르겠어요'],
    ['TEXT', '직접 적을래요'], ['NO_TALK', '말하고 싶지 않아요']
  ];

  function app() { return document.getElementById('app'); }

  function init() {
    if (!SCHOOL.execUrl || SCHOOL.execUrl.includes('PASTE_')) {
      renderSetupNeeded();
      return;
    }

    // Apps Script 브리지는 첫 화면과 동시에 백그라운드에서 준비한다.
    S.bridgePromise = window.MI_API.connect(SCHOOL.execUrl).catch(err => {
      console.warn('Bridge connect:', err);
      return Promise.reject(err);
    });

    const mode = new URLSearchParams(window.location.search).get('mode') || '';
    if (mode === 'staff') {
      S.staffSession = sessionStorage.getItem(STAFF_SESSION_KEY) || '';
      if (S.staffSession) loadStaffDashboard(true);
      else renderStaffLogin();
      warmServerInBackground();
      return;
    }

    S.deviceToken = localStorage.getItem(DEVICE_KEY) || '';

    if (S.deviceToken) {
      // 개인정보를 보이지 않는 일반 학생 화면은 즉시 표시한다.
      renderMoodHome(true);
      resendPendingByBeacon();
      verifyAutoLoginInBackground();
    } else {
      // 로그인 화면은 즉시 보여주고, 학생이 입력하는 동안 Apps Script를 미리 깨운다.
      renderLogin();
      warmServerInBackground();
    }
  }

  function warmServerInBackground() {
    try {
      const sep = SCHOOL.execUrl.includes('?') ? '&' : '?';
      fetch(SCHOOL.execUrl + sep + 'warmup=1&_=' + Date.now(), {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit'
      }).catch(() => {});
    } catch (_) {}
  }

  function brandHtml() {
    return `<div class="brand"><h1>마음이음</h1><p>마음을 살피고, 도움을 잇다 · ${escapeHtml(SCHOOL.name || '')}</p></div>`;
  }

  function renderSetupNeeded() {
    app().innerHTML = `<div class="shell">${brandHtml()}<section class="card setup">
      <h2 class="title">연결 주소 설정이 필요합니다</h2>
      <p><code>js/schools.js</code> 파일의 <code>execUrl</code>에 Apps Script 웹앱의 <code>/exec</code> 주소를 붙여 넣어 주세요.</p>
    </section></div>`;
  }

  function renderLogin(message = '') {
    app().innerHTML = `<div class="shell">${brandHtml()}<section class="card">
      <h2 class="title">처음 한 번만 확인할게요</h2>
      <p class="sub">아이디와 6자리 접속코드를 입력하면 개인기기에서는 다음부터 바로 시작할 수 있어요.</p>
      <form id="loginForm">
        <div class="field"><label for="loginId">아이디</label><input id="loginId" autocomplete="username" maxlength="20" placeholder="예: 바다7"></div>
        <div class="field"><label for="accessCode">접속코드</label><input id="accessCode" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="6자리 숫자"></div>
        <label class="check"><input id="rememberDevice" type="checkbox" checked><span>이 기기는 나만 사용하는 개인기기입니다. 다음부터 자동으로 접속할게요.</span></label>
        <button class="primary" id="loginBtn" type="submit">접속하기</button>
        <div class="status" id="loginStatus">${escapeHtml(message)}</div>
      </form>
      <div class="entry-switch"><button class="linkbtn" id="staffEntryBtn" type="button">교직원 접속</button></div>
    </section></div>`;

    document.getElementById('loginForm').addEventListener('submit', doLogin);
    document.getElementById('staffEntryBtn').addEventListener('click', () => switchMode('staff'));
  }

  async function doLogin(event) {
    event.preventDefault();
    const loginId = document.getElementById('loginId').value.trim();
    const accessCode = document.getElementById('accessCode').value.trim();
    const remember = document.getElementById('rememberDevice').checked;
    const btn = document.getElementById('loginBtn');
    const status = document.getElementById('loginStatus');

    if (!loginId || !/^\d{6}$/.test(accessCode)) {
      status.textContent = '아이디와 6자리 접속코드를 확인해 주세요.';
      return;
    }

    btn.disabled = true;
    status.textContent = '아이디와 접속코드를 확인하고 있어요…';
    const started = perfNow();
    try {
      await S.bridgePromise;
      const res = await window.MI_API.call('loginStudent', [loginId, accessCode, remember, deviceAlias()]);
      S.deviceToken = res.deviceToken;
      S.rememberDevice = !!res.rememberDevice;
      S.user = res.user || null;
      S.authVerified = true;
      S.lastAuthTotalMs = Math.max(0, perfNow() - started);
      S.lastAuthServerMs = Number(res.serverMs || 0);
      S.lastAuthCacheHit = !!res.cacheHit;
      if (remember) localStorage.setItem(DEVICE_KEY, S.deviceToken);
      else localStorage.removeItem(DEVICE_KEY);
      renderMoodHome(false);
      setStatus(authTimingText('접속 완료'));
      flushPendingThroughBridge();
    } catch (err) {
      btn.disabled = false;
      status.textContent = err.message || '로그인할 수 없습니다.';
    }
  }

  function renderMoodHome(instant) {
    const userLine = S.user
      ? `<strong>${escapeHtml(S.user.name)}</strong> · ${escapeHtml(String(S.user.grade || ''))}학년 ${escapeHtml(String(S.user.classNo || ''))}반`
      : (instant ? '자동접속을 확인하는 동안 먼저 마음을 선택할 수 있어요.' : '');

    app().innerHTML = `<div class="shell">${brandHtml()}<section class="card">
      <div class="profile"><span id="profileText">${userLine}</span><span class="profile-actions"><button class="linkbtn" id="staffModeBtn" type="button">교직원</button><button class="linkbtn" id="logoutBtn" type="button">다른 계정</button></span></div>
      <h2 class="title">오늘 마음은 어때?</h2>
      <p class="sub">가장 가까운 마음 하나를 골라 주세요. 오래 생각하지 않아도 괜찮아요.</p>
      <div class="moods" id="moods">
        ${MOODS.map(m => `<button class="mood" data-code="${m.code}" type="button"><span class="emoji">${m.emoji}</span><span>${m.label}</span></button>`).join('')}
      </div>
      <div id="followArea"></div>
      <div id="saveStatus" class="status">${instant ? '자동접속을 뒤에서 안전하게 확인하고 있어요.' : ''}</div>
    </section></div>`;

    document.querySelectorAll('.mood').forEach(btn => btn.addEventListener('click', () => selectMood(btn.dataset.code)));
    document.getElementById('logoutBtn').addEventListener('click', logoutAndSwitch);
    document.getElementById('staffModeBtn').addEventListener('click', () => switchMode('staff'));
  }

  function selectMood(code) {
    const mood = MOODS.find(m => m.code === code);
    if (!mood) return;
    S.currentMoodCode = code;
    if (!S.currentRecordId) S.currentRecordId = makeRecordId();

    document.querySelectorAll('.mood').forEach(el => el.classList.toggle('selected', el.dataset.code === code));

    queuePending({
      recordId: S.currentRecordId,
      moodCode: code,
      reasonCode: S.reasonCode,
      reasonText: S.reasonText,
      helpWish: S.helpWish,
      createdAt: Date.now()
    });

    const sent = sendQuickMoodBeacon(S.currentRecordId, code);
    setStatus(sent ? '마음을 바로 전달하고 있어요. 이제 다음 선택을 해도 되고 바로 나가도 괜찮아요.' : '마음을 보관했어요. 연결되는 즉시 다시 전달할게요.');

    if (mood.followup) renderNegativeFollowup();
    else document.getElementById('followArea').innerHTML = '';

    // 자동인증 전에는 빠른전송만 사용한다. 인증 RPC와 저장 RPC가 동시에 경쟁하지 않게 한다.
    if (S.authVerified && window.MI_API.isReady()) flushPendingThroughBridge();
  }

  function renderNegativeFollowup() {
    const area = document.getElementById('followArea');
    area.innerHTML = `<section class="follow">
      <h3>무엇 때문에 마음이 힘든가요?</h3>
      <div class="chips" id="reasonChips">${REASONS.map(([code,label]) => `<button class="chip" type="button" data-reason="${code}">${label}</button>`).join('')}</div>
      <input id="reasonText" class="textbox" maxlength="300" placeholder="말하고 싶은 만큼만 적어 주세요.">
      <div class="helpbox">
        <h3>지금 누군가와 이야기하고 싶은가요?</h3>
        <div class="help-actions">
          <button class="helpbtn" data-help="TALK_TEACHER" type="button">선생님과 이야기하고 싶어요</button>
          <button class="helpbtn" data-help="WATCH" type="button">조금 더 지켜볼래요</button>
          <button class="helpbtn" data-help="NO_TALK" type="button">지금은 말하고 싶지 않아요</button>
          <button class="helpbtn urgent" data-help="NEED_HELP_NOW" type="button">지금 도움이 필요해요</button>
        </div>
        <div id="urgentNote"></div>
      </div>
    </section>`;

    document.querySelectorAll('[data-reason]').forEach(btn => btn.addEventListener('click', () => chooseReason(btn.dataset.reason)));
    document.querySelectorAll('[data-help]').forEach(btn => btn.addEventListener('click', () => chooseHelp(btn.dataset.help)));
    document.getElementById('reasonText').addEventListener('change', (e) => {
      S.reasonText = e.target.value.trim();
      saveFollowup();
    });
  }

  function chooseReason(code) {
    S.reasonCode = code;
    document.querySelectorAll('[data-reason]').forEach(el => el.classList.toggle('selected', el.dataset.reason === code));
    const text = document.getElementById('reasonText');
    text.style.display = code === 'TEXT' ? 'block' : 'none';
    if (code !== 'TEXT') S.reasonText = '';
    saveFollowup();
  }

  function chooseHelp(wish) {
    S.helpWish = wish;
    document.querySelectorAll('[data-help]').forEach(el => el.classList.toggle('selected', el.dataset.help === wish));
    const note = document.getElementById('urgentNote');
    if (wish === 'NEED_HELP_NOW') {
      note.innerHTML = `<div class="note"><strong>지금 바로 도움을 받아도 됩니다.</strong><br>온라인 기록만 기다리지 말고 가까운 선생님, 보호자 또는 믿을 수 있는 어른에게 지금 바로 알려 주세요.</div>`;
    } else {
      note.innerHTML = '';
    }
    saveFollowup();
  }

  function saveFollowup() {
    if (!S.currentRecordId || !S.currentMoodCode) return;
    queuePending({
      recordId: S.currentRecordId,
      moodCode: S.currentMoodCode,
      reasonCode: S.reasonCode,
      reasonText: S.reasonText,
      helpWish: S.helpWish,
      createdAt: Date.now()
    });
    const sent = sendFollowupBeacon(S.currentRecordId, S.reasonCode, S.reasonText, S.helpWish);
    setStatus(sent ? '추가 선택도 바로 전달하고 있어요.' : '추가 선택을 잠시 보관했어요. 연결되는 즉시 다시 전달할게요.');
    if (S.authVerified && window.MI_API.isReady()) flushPendingThroughBridge();
  }

  async function verifyAutoLoginInBackground() {
    const started = perfNow();
    try {
      await S.bridgePromise;
      const res = await window.MI_API.call('resumeStudent', [S.deviceToken]);
      S.user = res.user || null;
      S.authVerified = true;
      S.lastAuthTotalMs = Math.max(0, perfNow() - started);
      S.lastAuthServerMs = Number(res.serverMs || 0);
      S.lastAuthCacheHit = !!res.cacheHit;
      const p = document.getElementById('profileText');
      if (p && S.user) p.innerHTML = `<strong>${escapeHtml(S.user.name)}</strong> · ${escapeHtml(String(S.user.grade || ''))}학년 ${escapeHtml(String(S.user.classNo || ''))}반`;
      setStatus(authTimingText('자동접속 완료'));
      await flushPendingThroughBridge();
    } catch (err) {
      localStorage.removeItem(DEVICE_KEY);
      clearPending();
      S.deviceToken = '';
      S.authVerified = false;
      renderLogin('자동접속이 만료되었습니다. 아이디와 접속코드로 다시 확인해 주세요.');
      warmServerInBackground();
    }
  }

  async function flushPendingThroughBridge() {
    if (!S.deviceToken || !window.MI_API.isReady()) return;
    const items = getPending();
    if (!items.length) return;

    for (const item of items) {
      try {
        await window.MI_API.call('saveQuickMood', [S.deviceToken, item.recordId, item.moodCode, 'BRIDGE_CONFIRM']);
        if (item.reasonCode || item.reasonText || item.helpWish) {
          await window.MI_API.call('updateMoodFollowup', [S.deviceToken, item.recordId, item.reasonCode || '', item.reasonText || '', item.helpWish || '']);
        }
        removePending(item.recordId);
        if (item.recordId === S.currentRecordId) setStatus('오늘 마음을 안전하게 저장했어요 ✓', false);
      } catch (err) {
        // pending은 남겨 두고 다음 접속에서 같은 기록ID로 재전송한다.
        console.warn('pending save:', err);
      }
    }
  }

  function resendPendingByBeacon() {
    const items = getPending();
    for (const item of items) {
      sendQuickMoodBeacon(item.recordId, item.moodCode);
      if (item.reasonCode || item.reasonText || item.helpWish) {
        sendFollowupBeacon(item.recordId, item.reasonCode || '', item.reasonText || '', item.helpWish || '');
      }
    }
  }

  function sendQuickMoodBeacon(recordId, moodCode) {
    if (!S.deviceToken) return false;
    return postFast({ action: 'quickMood', token: S.deviceToken, recordId, moodCode, source: 'FAST_UI' });
  }

  function sendFollowupBeacon(recordId, reasonCode, reasonText, helpWish) {
    if (!S.deviceToken) return false;
    return postFast({ action: 'moodFollowup', token: S.deviceToken, recordId, reasonCode, reasonText, helpWish });
  }

  function postFast(data) {
    try {
      const body = new URLSearchParams();
      Object.entries(data).forEach(([k,v]) => body.append(k, String(v ?? '')));
      if (navigator.sendBeacon) {
        const blob = new Blob([body.toString()], { type: 'application/x-www-form-urlencoded;charset=UTF-8' });
        if (navigator.sendBeacon(SCHOOL.execUrl, blob)) return true;
      }
      fetch(SCHOOL.execUrl, { method: 'POST', mode: 'no-cors', keepalive: true, body });
      return true;
    } catch (_) {
      return false;
    }
  }

  function queuePending(item) {
    if (!S.rememberDevice && !localStorage.getItem(DEVICE_KEY)) return; // 공용기기는 민감 선택을 로컬에 남기지 않는다.
    const list = getPending().filter(x => x.recordId !== item.recordId);
    list.push(item);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-5)));
  }

  function getPending() {
    try {
      const v = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }

  function removePending(recordId) {
    const list = getPending().filter(x => x.recordId !== recordId);
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_KEY);
  }

  function clearPending() { localStorage.removeItem(PENDING_KEY); }

  async function logoutAndSwitch() {
    const token = S.deviceToken;
    localStorage.removeItem(DEVICE_KEY);
    clearPending();
    S.deviceToken = '';
    S.user = null;
    S.currentRecordId = '';
    if (token && window.MI_API.isReady()) {
      try { await window.MI_API.call('revokeMyDevice', [token]); } catch (_) {}
    }
    renderLogin();
  }


  function switchMode(mode) {
    const url = new URL(window.location.href);
    if (mode === 'staff') url.searchParams.set('mode', 'staff');
    else url.searchParams.delete('mode');
    window.location.href = url.toString();
  }

  function renderStaffLogin(message = '') {
    app().innerHTML = `<div class="shell staff-shell">${brandHtml()}<section class="card">
      <div class="section-kicker">교직원 안전망</div>
      <h2 class="title">교직원 접속</h2>
      <p class="sub">교직원 아이디와 6자리 접속코드를 입력해 주세요. 교직원 화면은 브라우저를 닫으면 다시 로그인하도록 설계했습니다.</p>
      <form id="staffLoginForm">
        <div class="field"><label for="staffLoginId">아이디</label><input id="staffLoginId" autocomplete="username" maxlength="20" placeholder="예: 담임1"></div>
        <div class="field"><label for="staffAccessCode">접속코드</label><input id="staffAccessCode" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="6자리 숫자"></div>
        <button class="primary" id="staffLoginBtn" type="submit">교직원 접속</button>
        <div class="status" id="staffLoginStatus">${escapeHtml(message)}</div>
      </form>
      <div class="entry-switch"><button class="linkbtn" id="studentEntryBtn" type="button">학생 화면으로 돌아가기</button></div>
    </section></div>`;
    document.getElementById('staffLoginForm').addEventListener('submit', doStaffLogin);
    document.getElementById('studentEntryBtn').addEventListener('click', () => switchMode('student'));
  }

  async function doStaffLogin(event) {
    event.preventDefault();
    const loginId = document.getElementById('staffLoginId').value.trim();
    const accessCode = document.getElementById('staffAccessCode').value.trim();
    const btn = document.getElementById('staffLoginBtn');
    const status = document.getElementById('staffLoginStatus');
    if (!loginId || !/^\d{6}$/.test(accessCode)) {
      status.textContent = '교직원 아이디와 6자리 접속코드를 확인해 주세요.';
      return;
    }
    btn.disabled = true;
    status.textContent = '교직원 권한을 확인하고 있어요…';
    try {
      await S.bridgePromise;
      const res = await window.MI_API.call('loginStaff', [loginId, accessCode]);
      S.staffSession = res.sessionToken || '';
      S.staffUser = res.user || null;
      if (!S.staffSession) throw new Error('교직원 세션을 만들 수 없습니다.');
      sessionStorage.setItem(STAFF_SESSION_KEY, S.staffSession);
      await loadStaffDashboard(false);
    } catch (err) {
      btn.disabled = false;
      status.textContent = err.message || '교직원으로 접속할 수 없습니다.';
    }
  }

  async function loadStaffDashboard(silent) {
    if (!S.staffSession) {
      renderStaffLogin();
      return;
    }
    if (!silent) renderStaffLoading('오늘 확인할 내용을 불러오고 있어요…');
    else renderStaffLoading('교직원 세션을 확인하고 있어요…');
    try {
      await S.bridgePromise;
      const res = await window.MI_API.call('getStaffDashboard', [S.staffSession]);
      S.staffDashboard = res;
      S.staffUser = res.user || S.staffUser;
      renderStaffDashboard(res);
    } catch (err) {
      sessionStorage.removeItem(STAFF_SESSION_KEY);
      S.staffSession = '';
      renderStaffLogin(err.message || '교직원 세션이 만료되었습니다. 다시 로그인해 주세요.');
    }
  }

  function renderStaffLoading(message) {
    app().innerHTML = `<div class="shell staff-shell">${brandHtml()}<section class="card">
      <div class="section-kicker">교직원 안전망</div>
      <h2 class="title">잠시만 기다려 주세요</h2>
      <p class="sub">${escapeHtml(message || '')}</p>
      <div class="loading-line"></div>
    </section></div>`;
  }

  function staffProfileLine(user) {
    if (!user) return '';
    const assigned = user.role === 'HOMEROOM' ? ` · ${escapeHtml(String(user.grade || ''))}학년 ${escapeHtml(String(user.classNo || ''))}반` : '';
    return `<strong>${escapeHtml(user.name || '')}</strong> · ${escapeHtml(user.roleLabel || '교직원')}${assigned}`;
  }

  function renderStaffDashboard(data) {
    const user = data.user || {};
    const summary = data.summary || {};
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const restricted = data.accessMode === 'ADMIN_SYSTEM_ONLY' || data.accessMode === 'SUBJECT_SIGNAL_ONLY';

    app().innerHTML = `<div class="shell staff-shell">${brandHtml()}<section class="card staff-card">
      <div class="profile"><span>${staffProfileLine(user)}</span><span class="profile-actions"><button class="linkbtn" id="staffRefreshBtn" type="button">새로고침</button><button class="linkbtn" id="staffLogoutBtn" type="button">로그아웃</button></span></div>
      <div class="section-kicker">교직원 안전망</div>
      <h2 class="staff-title">오늘 확인할 학생</h2>
      ${restricted ? `<div class="privacy-note">${escapeHtml(data.message || '')}</div>` : `
        <div class="summary-grid">
          <div class="summary-box"><strong>${Number(summary.directHelp || 0)}</strong><span>직접 도움요청</span></div>
          <div class="summary-box"><strong>${Number(summary.negativeMood || 0)}</strong><span>오늘 힘든 마음</span></div>
          <div class="summary-box"><strong>${Number(summary.friendSignals || 0)}</strong><span>친구 걱정</span></div>
          <div class="summary-box"><strong>${Number(summary.teacherSignals || 0)}</strong><span>교사 관찰</span></div>
        </div>
        <p class="staff-guide">표시는 학생이 실제로 남긴 기록과 도움요청을 묶어 보여주는 것입니다. 위험도를 자동 판정하지 않습니다.</p>
        <div class="signal-list" id="staffSignalList">${cards.length ? cards.map(staffCardHtml).join('') : `<div class="empty-state">현재 확인 대기 중인 기록이 없습니다.</div>`}</div>
      `}
      <div class="entry-switch"><button class="linkbtn" id="studentModeFromStaff" type="button">학생 화면</button></div>
    </section></div>`;

    document.getElementById('staffRefreshBtn').addEventListener('click', () => loadStaffDashboard(false));
    document.getElementById('staffLogoutBtn').addEventListener('click', staffLogout);
    document.getElementById('studentModeFromStaff').addEventListener('click', () => switchMode('student'));
    document.querySelectorAll('[data-open-student]').forEach(btn => btn.addEventListener('click', () => openStudentSafety(btn.dataset.openStudent)));
  }

  function staffCardHtml(c) {
    const help = Array.isArray(c.directHelp) ? c.directHelp : [];
    const urgent = help.some(h => h.requestType === 'NEED_HELP_NOW');
    const talk = help.some(h => h.requestType === 'TALK_TEACHER');
    const badges = [];
    if (urgent) badges.push('<span class="signal-badge urgent">지금 도움 요청</span>');
    else if (talk) badges.push('<span class="signal-badge help">대화 요청</span>');
    if (c.mood) badges.push(`<span class="signal-badge mood-badge">${escapeHtml(c.mood.label || '힘든 마음')}</span>`);
    if (Number(c.friendCount || 0)) badges.push(`<span class="signal-badge">친구 걱정 ${Number(c.friendCount)}</span>`);
    if (Number(c.teacherSignalCount || 0)) badges.push(`<span class="signal-badge">교사 관찰 ${Number(c.teacherSignalCount)}</span>`);
    return `<article class="student-signal-card ${urgent ? 'urgent-card' : ''}">
      <div><div class="student-name">${escapeHtml(c.name || '')}</div><div class="student-meta">${escapeHtml(String(c.grade || ''))}학년 ${escapeHtml(String(c.classNo || ''))}반 ${escapeHtml(String(c.studentNo || ''))}번</div></div>
      <div class="signal-badges">${badges.join('')}</div>
      ${c.mood && c.mood.reasonLabel ? `<div class="signal-line">이유 선택: ${escapeHtml(c.mood.reasonLabel)}</div>` : ''}
      <button class="secondary" type="button" data-open-student="${escapeHtml(c.studentId || '')}">내용 확인</button>
    </article>`;
  }

  async function openStudentSafety(studentId) {
    renderStaffLoading('학생의 기록을 안전하게 불러오고 있어요…');
    try {
      const res = await window.MI_API.call('getStudentSafetySummary', [S.staffSession, studentId]);
      renderStudentSafetyDetail(res);
    } catch (err) {
      renderStaffDashboard(S.staffDashboard || { user: S.staffUser, summary: {}, cards: [] });
      alert(err.message || '학생 정보를 불러올 수 없습니다.');
    }
  }

  function renderStudentSafetyDetail(data) {
    const st = data.student || {};
    const helps = Array.isArray(data.helpRequests) ? data.helpRequests : [];
    const moods = Array.isArray(data.moods) ? data.moods : [];
    const friends = Array.isArray(data.friendSignals) ? data.friendSignals : [];
    const teacherSignals = Array.isArray(data.teacherSignals) ? data.teacherSignals : [];

    app().innerHTML = `<div class="shell staff-shell">${brandHtml()}<section class="card staff-card">
      <div class="profile"><span>${staffProfileLine(S.staffUser)}</span><button class="linkbtn" id="backDashboardBtn" type="button">← 오늘 확인 목록</button></div>
      <div class="student-detail-head"><div><div class="section-kicker">학생 확인</div><h2>${escapeHtml(st.name || '')}</h2><p>${escapeHtml(String(st.grade || ''))}학년 ${escapeHtml(String(st.classNo || ''))}반 ${escapeHtml(String(st.studentNo || ''))}번</p></div></div>

      <section class="detail-section"><h3>직접 도움요청</h3>
        ${helps.length ? helps.map(helpDetailHtml).join('') : '<div class="empty-inline">현재 열린 도움요청이 없습니다.</div>'}
      </section>

      <section class="detail-section"><h3>최근 마음 기록</h3>
        ${moods.length ? moods.map(moodDetailHtml).join('') : '<div class="empty-inline">최근 마음 기록이 없습니다.</div>'}
      </section>

      <section class="detail-section"><h3>친구 걱정 · 교사 관찰</h3>
        ${friends.length ? friends.map(x => signalDetailHtml('친구 걱정', x)).join('') : ''}
        ${teacherSignals.length ? teacherSignals.map(x => signalDetailHtml('교사 관찰', x)).join('') : ''}
        ${(!friends.length && !teacherSignals.length) ? '<div class="empty-inline">현재 열린 신호가 없습니다.</div>' : ''}
      </section>

      ${data.canStartCounseling ? '<div class="phase-next">상담 기록 · 마음EASY 연계 · 후속확인은 다음 Phase 3 단계에서 이 화면에 연결합니다.</div>' : ''}
    </section></div>`;

    document.getElementById('backDashboardBtn').addEventListener('click', () => renderStaffDashboard(S.staffDashboard));
    document.querySelectorAll('[data-ack-help]').forEach(btn => btn.addEventListener('click', () => acknowledgeHelp(btn.dataset.ackHelp, st.studentId)));
  }

  function helpDetailHtml(h) {
    const newReq = h.status === 'NEW';
    return `<div class="detail-item ${h.type === 'NEED_HELP_NOW' ? 'urgent-detail' : ''}">
      <div class="detail-top"><strong>${escapeHtml(h.label || '도움 요청')}</strong><span>${escapeHtml(h.at || '')}</span></div>
      <div class="detail-meta">상태: ${escapeHtml(h.status === 'ACKNOWLEDGED' ? '교직원 확인함' : h.status || 'NEW')}</div>
      ${newReq ? `<button class="secondary ack-btn" type="button" data-ack-help="${escapeHtml(h.requestId || '')}">이 요청을 확인했습니다</button>` : ''}
    </div>`;
  }

  function moodDetailHtml(m) {
    const reasonText = m.reasonText ? `<div class="detail-text">학생이 적은 내용: ${escapeHtml(m.reasonText)}</div>` : '';
    return `<div class="detail-item"><div class="detail-top"><strong>${escapeHtml(m.moodLabel || '')}</strong><span>${escapeHtml(m.at || '')}</span></div>
      ${m.reasonLabel ? `<div class="detail-meta">이유: ${escapeHtml(m.reasonLabel)}</div>` : ''}
      ${m.helpLabel ? `<div class="detail-meta">학생 선택: ${escapeHtml(m.helpLabel)}</div>` : ''}
      ${reasonText}</div>`;
  }

  function signalDetailHtml(label, x) {
    return `<div class="detail-item"><div class="detail-top"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(x.at || '')}</span></div>
      ${x.type ? `<div class="detail-meta">유형: ${escapeHtml(x.type)}</div>` : ''}
      ${x.content ? `<div class="detail-text">${escapeHtml(x.content)}</div>` : ''}</div>`;
  }

  async function acknowledgeHelp(requestId, studentId) {
    try {
      await window.MI_API.call('acknowledgeHelpRequest', [S.staffSession, requestId]);
      const dash = await window.MI_API.call('getStaffDashboard', [S.staffSession]);
      S.staffDashboard = dash;
      const detail = await window.MI_API.call('getStudentSafetySummary', [S.staffSession, studentId]);
      renderStudentSafetyDetail(detail);
    } catch (err) {
      alert(err.message || '도움요청을 확인 처리할 수 없습니다.');
    }
  }

  function staffLogout() {
    sessionStorage.removeItem(STAFF_SESSION_KEY);
    S.staffSession = '';
    S.staffUser = null;
    S.staffDashboard = null;
    renderStaffLogin('교직원 로그아웃이 완료되었습니다.');
  }

  function setStatus(text, isError = false) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (isError ? ' error' : '');
  }

  function perfNow() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function fmtSeconds(ms) {
    return (Math.max(0, Number(ms || 0)) / 1000).toFixed(1);
  }

  function authTimingText(prefix) {
    const total = fmtSeconds(S.lastAuthTotalMs);
    const server = fmtSeconds(S.lastAuthServerMs);
    const path = S.lastAuthCacheHit ? ' · 빠른 캐시' : '';
    const first = fmtSeconds(perfNow() - BOOT_AT);
    return `${prefix} · 인증 ${total}초 · 서버 ${server}초${path} · 화면 ${first}초`;
  }

  function makeRecordId() {
    let tail;
    if (crypto && crypto.randomUUID) tail = crypto.randomUUID().replace(/-/g, '');
    else tail = Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
    return 'QM-' + tail.slice(0, 32);
  }

  function deviceAlias() {
    const ua = navigator.userAgent || '';
    return /Android/i.test(ua) ? 'Android 개인기기' : /iPhone|iPad/i.test(ua) ? 'iOS 개인기기' : '브라우저 개인기기';
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
