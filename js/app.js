(() => {
  const SCHOOL = window.MI_SCHOOL || {};
  const DEVICE_KEY = `mi_device_token_${SCHOOL.code || 'school'}`;
  const PENDING_KEY = `mi_pending_mood_${SCHOOL.code || 'school'}`;

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
    authVerified: false
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

    S.deviceToken = localStorage.getItem(DEVICE_KEY) || '';

    if (S.deviceToken) {
      // 개인정보를 보이지 않는 일반 학생 화면은 즉시 표시한다.
      renderMoodHome(true);
      resendPendingByBeacon();
      verifyAutoLoginInBackground();
    } else {
      // 브리지 연결을 기다리지 않고 로그인 화면부터 즉시 보여준다.
      renderLogin();
    }
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
    </section></div>`;

    document.getElementById('loginForm').addEventListener('submit', doLogin);
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
    try {
      await S.bridgePromise;
      const res = await window.MI_API.call('loginStudent', [loginId, accessCode, remember, deviceAlias()]);
      S.deviceToken = res.deviceToken;
      S.rememberDevice = !!res.rememberDevice;
      S.user = res.user || null;
      S.authVerified = true;
      if (remember) localStorage.setItem(DEVICE_KEY, S.deviceToken);
      else localStorage.removeItem(DEVICE_KEY);
      renderMoodHome(false);
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
      <div class="profile"><span id="profileText">${userLine}</span><button class="linkbtn" id="logoutBtn" type="button">다른 계정</button></div>
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

    // 브리지가 이미 준비되었다면 같은 기록ID로 서버 확인까지 진행한다.
    if (window.MI_API.isReady()) flushPendingThroughBridge();
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
    if (window.MI_API.isReady()) flushPendingThroughBridge();
  }

  async function verifyAutoLoginInBackground() {
    try {
      await S.bridgePromise;
      const res = await window.MI_API.call('resumeStudent', [S.deviceToken]);
      S.user = res.user || null;
      S.authVerified = true;
      const p = document.getElementById('profileText');
      if (p && S.user) p.innerHTML = `<strong>${escapeHtml(S.user.name)}</strong> · ${escapeHtml(String(S.user.grade || ''))}학년 ${escapeHtml(String(S.user.classNo || ''))}반`;
      await flushPendingThroughBridge();
    } catch (err) {
      localStorage.removeItem(DEVICE_KEY);
      clearPending();
      S.deviceToken = '';
      S.authVerified = false;
      renderLogin('자동접속이 만료되었습니다. 아이디와 접속코드로 다시 확인해 주세요.');
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

  function setStatus(text, isError = false) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (isError ? ' error' : '');
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
