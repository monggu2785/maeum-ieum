(() => {
  'use strict';

  const APP_START = performance.now();

  const S = {
    schoolCode:'', school:null, config:null,
    sessionToken:'', user:null, home:null,
    quickWriteToken:'', busy:false, pendingMood:'', instantShownAt:0, instantVisibleSec:''
  };
  const $ = id => document.getElementById(id);
  const main = () => $('main');

  document.addEventListener('DOMContentLoaded', init);

  function init(){
    $('exitBtn').addEventListener('click', logout);

    // 0.1.4: 학생이 감정을 누른 직후 창을 닫아도 마지막 빠른기록을 한 번 더 전송합니다.
    window.addEventListener('pagehide', flushPendingMoodBeacon);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPendingMoodBeacon();
    });

    const saved = localStorage.getItem('mi_school_code') || '';
    if (saved && window.MI_SCHOOLS && window.MI_SCHOOLS[saved]) connectSchool(saved, true);
    else renderSchoolGate();
  }

  function renderSchoolGate(){
    setHeader(false);
    main().innerHTML = `
      <section class="card hero">
        <img class="hero-logo" src="./assets/maeum-ieum-logo.png" alt="마음이음">
        <div class="slogan">마음을 살피고, 도움을 잇다</div>
        <p class="sub">처음 한 번만 학교코드를 확인합니다. 같은 기기에서는 학교 선택을 기억할 수 있습니다.</p>
        <div class="field">
          <label for="schoolCode">학교코드</label>
          <input id="schoolCode" autocomplete="off" autocapitalize="characters" placeholder="예: HS001">
        </div>
        <button class="btn full" id="schoolConnectBtn" type="button">학교 확인</button>
        <div style="height:10px"></div>
        <div class="notice warn"><b>Hybrid 0.1.6.2 관리자 계정관리판</b><br><span class="sub">학생이 마음을 선택하는 순간 서버 전송을 시작하고, 바로 창을 닫아도 전송을 계속 시도합니다. 서버 확인 전에는 저장 완료라고 표시하지 않습니다.</span></div>
      </section>`;
    $('schoolConnectBtn').onclick = () => connectSchool(($('schoolCode').value || '').trim().toUpperCase(), false);
    $('schoolCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('schoolConnectBtn').click(); });
  }

  async function connectSchool(code, silent){
    code = String(code || '').trim().toUpperCase();
    const school = window.MI_SCHOOLS && window.MI_SCHOOLS[code];
    if (!school) {
      if (!silent) toast('등록된 학교코드를 확인해 주세요.');
      else renderSchoolGate();
      return;
    }
    if (!school.bridgeUrl || school.bridgeUrl.includes('PASTE_YOUR')) {
      renderSetupNeeded(code, school);
      return;
    }

    S.schoolCode = code;
    S.school = school;

    // 0.1.4 핵심: 기기토큰이 있으면 Google 연결보다 먼저 학생용 공개 첫 화면을 즉시 표시합니다.
    const deviceToken = getDeviceToken();
    S.quickWriteToken = getQuickWriteToken();
    const optimisticStudent = !!deviceToken;
    const totalStart = performance.now();
    if (optimisticStudent) {
      S.instantShownAt = performance.now();
      renderInstantStudentShell(school.name);
      S.instantVisibleSec = ((performance.now()-APP_START)/1000).toFixed(2);
      setHeader(true);
    } else {
      renderConnecting(school.name);
    }

    try {
      const cfg = await window.MI_API.connect(school.bridgeUrl, code);
      S.config = cfg;
      localStorage.setItem('mi_school_code',code);
      setHeader(true);

      if (deviceToken) {
        try {
          updateInstantAuthStatus('학교 계정을 확인하고 있어요…', 'checking');
          const resumed = await window.MI_API.call('resumeStudent',[deviceToken]);
          if (resumed.quickWriteToken) setQuickWriteToken(resumed.quickWriteToken);
          await acceptLogin(resumed, true);
          await flushPendingMoodRpc();
          toast(`첫 화면 ${S.instantVisibleSec||'0'}초 · 자동인증 ${elapsedSec(totalStart)}초${resServer(resumed)}`);
          return;
        } catch (e) {
          clearDeviceToken();
          clearQuickWriteToken();
          S.pendingMood='';
          toast('자동접속 기간이 끝났습니다. 한 번만 다시 로그인해 주세요.');
          renderLogin();
          return;
        }
      }
      renderLogin();
    } catch (e) {
      if (optimisticStudent) updateInstantAuthStatus('학교 서버 연결을 확인해 주세요.', 'error');
      renderConnectionError(e.message || String(e));
    }
  }

  function renderInstantStudentShell(name){
    $('userPill').classList.add('hidden');
    $('exitBtn').classList.add('hidden');
    $('schoolPill').textContent=name||'';
    $('schoolPill').classList.remove('hidden');

    main().innerHTML = `
      <section class="instant-student" aria-busy="true">
        <div class="instant-kicker">${esc(name || '우리학교')}</div>
        <h2>오늘 마음은 어때?</h2>
        <p class="instant-sub">마음을 누르면 바로 전송을 시작합니다. 학교 계정 확인은 뒤에서 계속 진행됩니다.</p>

        <div class="mood-options" role="group" aria-label="오늘의 마음 선택">
          ${moodButton('great','😊','좋아요')}
          ${moodButton('good','🙂','괜찮아요')}
          ${moodButton('okay','😐','그냥 그래요')}
          ${moodButton('hard','😟','힘들어요')}
          ${moodButton('veryhard','😢','많이 힘들어요')}
        </div>

        <button class="quiet-choice" id="skipMoodBtn" type="button">오늘은 말하고 싶지 않아요</button>

        <div class="record-status idle" id="moodSaveStatus">
          <span id="moodSaveText">마음을 선택하면 바로 전송을 시작해요.</span>
        </div>

        <div class="instant-status checking" id="instantAuthStatus">
          <span class="mini-spinner" aria-hidden="true"></span>
          <span id="instantAuthText">Google 서버와 안전하게 연결 중이에요…</span>
        </div>
        <p class="instant-note" id="instantNote">이 화면에는 이름·상담기록 같은 개인정보를 표시하지 않습니다. 전송이 확인되기 전에는 '저장됨'이라고 표시하지 않습니다.</p>
      </section>`;

    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', () => selectPreviewMood(btn.dataset.mood, btn));
    });
    $('skipMoodBtn').onclick=()=>selectPreviewMood('skip', $('skipMoodBtn'));
  }

  function moodButton(value, emoji, label){
    return `<button class="mood-btn" type="button" data-mood="${value}" aria-label="${esc(label)}"><span class="mood-emoji">${emoji}</span><span>${esc(label)}</span></button>`;
  }

  function selectPreviewMood(value, el){
    S.pendingMood=value;
    document.querySelectorAll('.mood-btn,.quiet-choice').forEach(x=>x.classList.remove('selected'));
    if(el) el.classList.add('selected');

    const note=$('instantNote');
    if(note) note.textContent='선택과 동시에 전송을 시작했습니다. 창을 바로 닫아도 브라우저가 전송을 계속 시도하고, 확인되지 않은 기록은 다음 접속 때 다시 보냅니다.';

    submitQuickMood(value);
  }

  function updateInstantAuthStatus(text, state){
    const box=$('instantAuthStatus');
    const label=$('instantAuthText');
    if(!box||!label) return;
    box.classList.remove('checking','ok','error');
    box.classList.add(state||'checking');
    label.textContent=text||'';
    if(state==='ok'){
      const spinner=box.querySelector('.mini-spinner');
      if(spinner) spinner.style.display='none';
    }
  }

  function renderSetupNeeded(code, school){
    S.schoolCode=code; S.school=school;
    main().innerHTML=`
      <section class="card hero">
        <span class="school-badge">${esc(school.name)} · ${esc(code)}</span>
        <h2>Google 연결 주소가 필요합니다</h2>
        <p class="sub">Apps Script를 배포한 뒤 <b>frontend/js/schools.js</b>의 bridgeUrl에 /exec 주소를 한 번 붙여 넣으면 됩니다.</p>
        <div class="notice">설치 순서는 함께 제공된 <b>START-HERE.md</b>를 따라 진행하세요.</div>
        <div style="height:14px"></div><button class="btn ghost full" onclick="location.reload()">처음으로</button>
      </section>`;
  }

  function renderConnecting(name){
    main().innerHTML=`<section class="card hero"><span class="school-badge">${esc(name)}</span><h2>마음이음을 준비하고 있어요</h2><div class="loading"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div><p class="sub">처음 연결하는 기기입니다. 학교 서버를 확인한 뒤 로그인 화면을 엽니다.</p></section>`;
  }

  function renderConnectionError(message){
    main().innerHTML=`
      <section class="card hero">
        <h2>학교 서버에 연결하지 못했습니다</h2>
        <p class="sub">${esc(message)}</p>
        <div class="notice warn">Apps Script가 <b>웹 앱</b>으로 배포되었는지, 접근 권한이 운영 환경에 맞게 설정되었는지, 설정 시트의 <b>허용프론트엔드Origin</b>이 현재 GitHub 주소와 일치하는지 확인해 주세요.</div>
        <div style="height:14px"></div>
        <button class="btn full" onclick="location.reload()">다시 시도</button>
      </section>`;
  }

  function renderLogin(prefillId){
    const cfg = S.config || {};
    main().innerHTML=`
      <section class="card hero">
        <span class="school-badge">${esc(cfg.schoolName || S.school?.name || '')}</span>
        <h2>반가워요</h2>
        <p class="sub">처음에는 발급받은 아이디와 접속코드를 입력합니다.</p>
        <div class="field"><label>아이디</label><input id="loginId" autocomplete="username" placeholder="예: ST-001 / T-01 / A-01" value="${esc(prefillId||'')}"></div>
        <div class="field"><label>접속코드</label><input id="loginCode" type="password" autocomplete="current-password" placeholder="접속코드 입력"></div>
        <div class="checkline"><input id="rememberDevice" type="checkbox"><label for="rememberDevice"><b>이 기기는 내 개인기기입니다.</b><br>학생은 최초 인증 후 일정 기간 다음 접속부터 바로 들어갈 수 있습니다. 공용 PC·공용 태블릿에서는 선택하지 마세요.</label></div>
        <button id="loginBtn" class="btn full" type="button">접속하기</button>
        <div style="height:10px"></div><button id="changeSchoolBtn" class="btn ghost full" type="button">다른 학교 선택</button>
        <div class="notice" style="margin-top:14px"><b>학생 사용 원칙</b><br><span class="sub">매일 숙제처럼 복잡하게 로그인하지 않도록 개인기기 자동접속을 지원합니다. 학생 ID와 접속코드 원문은 기기에 저장하지 않습니다.</span></div>
      </section>`;
    $('loginBtn').onclick=doLogin;
    $('changeSchoolBtn').onclick=changeSchool;
    $('loginCode').addEventListener('keydown', e=>{if(e.key==='Enter')doLogin();});
  }

  function renderLoginTransition(id){
    const studentLike=/^ST-/i.test(String(id||''));
    main().innerHTML = studentLike ? `
      <section class="instant-student login-transition" aria-busy="true">
        <div class="instant-kicker">${esc(S.config?.schoolName || S.school?.name || '')}</div>
        <h2>반가워요 🌱</h2>
        <p class="instant-sub">처음 한 번만 개인기기를 안전하게 확인하고 있어요.</p>
        <div class="mood-options muted-preview" aria-hidden="true">
          ${moodButton('great','😊','좋아요')}${moodButton('good','🙂','괜찮아요')}${moodButton('okay','😐','그냥 그래요')}${moodButton('hard','😟','힘들어요')}${moodButton('veryhard','😢','많이 힘들어요')}
        </div>
        <div class="instant-status checking"><span class="mini-spinner" aria-hidden="true"></span><span>접속정보를 확인하고 있어요…</span></div>
      </section>` : `
      <section class="card hero" aria-busy="true">
        <span class="school-badge">${esc(S.config?.schoolName || S.school?.name || '')}</span>
        <h2>마음이음을 안전하게 여는 중입니다</h2>
        <div class="loading"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>
        <p class="sub">교직원·관리자 정보는 인증이 완료된 뒤에만 표시합니다.</p>
      </section>`;
  }

  async function doLogin(){
    if (S.busy) return;
    const id=($('loginId').value||'').trim();
    const code=($('loginCode').value||'').trim();
    const remember=$('rememberDevice').checked;
    if(!id||!code) return toast('아이디와 접속코드를 입력해 주세요.');

    const speedStart=performance.now();
    S.busy=true;
    renderLoginTransition(id);
    try{
      const res=await window.MI_API.call('login',[id,code,remember,getDeviceAlias()]);
      if(res.deviceToken) setDeviceToken(res.deviceToken);
      if(res.quickWriteToken) setQuickWriteToken(res.quickWriteToken);
      await acceptLogin(res,false);
      await flushPendingMoodRpc();
      if(!res.mustChangeCode) toast(`접속인증 완료 · ${elapsedSec(speedStart)}초${resServer(res)} · 화면은 즉시 전환`);
    }catch(e){
      renderLogin(id);
      toast(e.message||String(e));
    }finally{
      S.busy=false;
    }
  }

  async function acceptLogin(res, auto){
    S.sessionToken=res.token; S.user=res.user;
    if(res.quickWriteToken) setQuickWriteToken(res.quickWriteToken);
    setHeader(true);
    if(res.mustChangeCode){ showChangeCode(true); return; }

    try{
      S.home=res.home || await window.MI_API.call('getHome',[S.sessionToken]);
      S.user=S.home.user;
      S.config=S.home.config || S.config;
      renderHome(auto);
    }catch(e){
      S.sessionToken=''; toast(e.message||String(e)); renderLogin();
    }
  }

  function renderHome(auto){
    const h=S.home||{}, u=h.user||{}, cfg=h.config||S.config||{};
    $('userPill').textContent=`${u.name||''} · ${u.roleLabel||''}`;
    $('userPill').classList.remove('hidden');
    $('exitBtn').classList.remove('hidden');
    $('schoolPill').textContent=cfg.schoolName||'';
    $('schoolPill').classList.remove('hidden');

    if(u.role==='student') return renderStudentHome(auto);
    if(u.role==='admin') return renderAdminHome();
    return renderStaffHome();
  }

  function renderStudentHome(auto){
    const h=S.home, s=h.student;
    main().innerHTML=`
      <div class="home-head"><h2>${esc(s.name)}님, 안녕하세요</h2><p>${esc(s.grade)}학년 ${esc(s.classNo)}반${s.number?' '+esc(s.number)+'번':''}${auto?' · 자동접속 확인됨':''}</p></div>
      <div class="grid grid2">
        <section class="big-action">
          <div class="section-title"><h3>오늘의 마음</h3><span class="badge">즉시 화면</span></div>
          <p class="sub">마음을 선택하면 즉시 빠른기록 전송을 시작합니다.</p>
          <div class="mood-options compact" role="group" aria-label="오늘의 마음 선택">
            ${moodButton('great','😊','좋아요')}${moodButton('good','🙂','괜찮아요')}${moodButton('okay','😐','그냥 그래요')}${moodButton('hard','😟','힘들어요')}${moodButton('veryhard','😢','많이 힘들어요')}
          </div>
          <button class="quiet-choice" id="homeSkipMoodBtn" type="button">오늘은 말하고 싶지 않아요</button>
          <div class="record-status idle" id="homeMoodSaveStatus"><span id="homeMoodSaveText">선택하면 바로 전송해요.</span></div>
          <p class="tiny-note">서버가 저장을 확인하면 ✓가 표시됩니다. 확인 전에 페이지를 닫아도 브라우저가 전송을 계속 시도합니다.</p>
        </section>
        <section class="card">
          <div class="section-title"><h3>개인기기 접속</h3><span class="badge">${getDeviceToken()?'자동접속 사용':'일반접속'}</span></div>
          <p class="sub">학생 ID와 접속코드를 매번 입력하지 않도록 개인기기에 안전한 무작위 기기 토큰만 보관합니다.</p>
          ${getDeviceToken()?'<button class="btn ghost" type="button" id="revokeDeviceBtn">이 기기 자동접속 해제</button>':''}
        </section>
      </div>
      <section class="card" style="margin-top:15px">
        <div class="section-title"><h3>0.1.6 빠른기록 확인</h3><span class="badge">정상</span></div>
        <div class="notice">GitHub 화면은 즉시 표시하고, 학교별 Apps Script 인증은 뒤에서 완료합니다. 개인정보와 과거 기록은 인증 전에는 표시하지 않습니다.</div>
      </section>`;

    if(S.pendingMood){
      const selected=document.querySelector(`.mood-btn[data-mood="${CSS.escape(S.pendingMood)}"]`);
      if(selected) selected.classList.add('selected');
    }
    document.querySelectorAll('.mood-btn').forEach(btn=>btn.onclick=()=>{
      document.querySelectorAll('.mood-btn,.quiet-choice').forEach(x=>x.classList.remove('selected'));
      btn.classList.add('selected');
      S.pendingMood=btn.dataset.mood;
      submitQuickMood(btn.dataset.mood);
    });
    if($('homeSkipMoodBtn')) $('homeSkipMoodBtn').onclick=()=>{
      document.querySelectorAll('.mood-btn,.quiet-choice').forEach(x=>x.classList.remove('selected'));
      $('homeSkipMoodBtn').classList.add('selected');
      S.pendingMood='skip';
      submitQuickMood('skip');
    };
    if($('revokeDeviceBtn')) $('revokeDeviceBtn').onclick=revokeCurrentDevice;
    reflectPendingMoodState();
  }

  function renderStaffHome(){
    const u=S.home.user, list=S.home.students||[];
    main().innerHTML=`
      <div class="home-head"><h2>${esc(u.name)}님</h2><p>${esc(u.roleLabel)} 권한으로 접속했습니다.</p></div>
      <div class="grid grid2">
        <section class="card"><div class="section-title"><h3>접근 범위</h3><span class="badge">${list.length}명</span></div><p class="sub">현재 역할에 따라 접근 가능한 학생의 기본정보 범위를 확인합니다.</p>${renderStudentMiniList(list)}</section>
        <section class="card"><div class="section-title"><h3>보안 원칙</h3><span class="badge">최소권한</span></div><div class="notice">교과교사는 상담 세부내용을 기본 열람하지 않고, 상담·보건교사도 필요한 지원권한이 부여된 학생만 민감정보에 접근하도록 확장합니다.</div><div style="height:12px"></div><button class="btn secondary" id="changeCodeBtn">내 접속코드 변경</button></section>
      </div>`;
    $('changeCodeBtn').onclick=()=>showChangeCode(false);
  }

  function renderAdminHome(){
    main().innerHTML=`
      <div class="home-head">
        <h2>${esc(S.home.user.name)}님</h2>
        <p>마음이음 학교 관리자 · Hybrid 0.1.6.2</p>
      </div>

      <div class="grid grid3" id="adminSummary">
        <section class="card">
          <div class="section-title"><h3>학생 계정</h3><span class="badge" id="sumStudents">확인 중</span></div>
          <p class="sub">재학생 계정의 등록·사용중지·접속코드 재발급을 관리합니다.</p>
        </section>
        <section class="card">
          <div class="section-title"><h3>교직원 계정</h3><span class="badge" id="sumStaff">확인 중</span></div>
          <p class="sub">담임·교과·상담·보건·관리자 계정과 승인 상태를 관리합니다.</p>
        </section>
        <section class="card">
          <div class="section-title"><h3>운영 DB</h3><span class="badge">새 DB</span></div>
          <p class="sub">현재 마음이음 데이터는 이전 완료한 학교 운영 DB에 저장됩니다.</p>
        </section>
      </div>

      <section class="card" style="margin-top:15px">
        <div class="section-title">
          <h3>계정 관리</h3>
          <span class="badge">관리자 전용</span>
        </div>

        <div class="grid grid2">
          <button class="btn" id="createStudentBtn" type="button">학생 신규등록</button>
          <button class="btn" id="createStaffBtn" type="button">교직원 신규등록</button>
          <button class="btn secondary" id="refreshAccountsBtn" type="button">학생·교직원 현황 새로고침</button>
          <button class="btn secondary" id="changeCodeBtn" type="button">내 접속코드 변경</button>
        </div>

        <div class="notice" style="margin-top:14px">
          <b>운영 원칙</b><br>
          <span class="sub">계정을 행에서 직접 삭제하지 않고 사용중지·재적상태 변경으로 관리해 이력을 보존합니다. 접속코드 원문은 DB에 저장하지 않습니다.</span>
        </div>

        <div id="adminPane" style="margin-top:16px"></div>
      </section>`;

    $('createStudentBtn').onclick=showCreateStudent;
    $('createStaffBtn').onclick=showCreateStaff;
    $('refreshAccountsBtn').onclick=loadAccounts;
    $('changeCodeBtn').onclick=()=>showChangeCode(false);

    loadAccounts();
  }


  function parseAdminDashboardPayload(raw){
    let data=raw;
    if(typeof raw==='string'){
      try{data=JSON.parse(raw);}catch(e){
        throw new Error('관리자 데이터 응답을 해석하지 못했습니다.');
      }
    }
    if(!data || typeof data!=='object'){
      throw new Error('관리자 데이터 응답이 비어 있습니다. Apps Script 웹앱이 0.1.6.2로 배포되었는지 확인해 주세요.');
    }
    return data;
  }


  async function loadAccounts(){
    if(!$('adminPane')) return;
    $('adminPane').innerHTML='<div class="loading"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>';

    try{
      const raw=await window.MI_API.call('adminGetAccountDashboard',[S.sessionToken]);
      const data=parseAdminDashboardPayload(raw);
      const students=Array.isArray(data.students)?data.students:[];
      const staff=Array.isArray(data.staff)?data.staff:[];
      const summary=data.summary||{};
      const stSummary=summary.students||{};
      const sfSummary=summary.staff||{};

      if($('sumStudents')) $('sumStudents').textContent=`사용 ${stSummary.active||0} / 전체 ${stSummary.total||students.length}`;
      if($('sumStaff')) $('sumStaff').textContent=`사용 ${sfSummary.active||0} / 전체 ${sfSummary.total||staff.length}`;

      $('adminPane').innerHTML=`
        <div class="section-title">
          <h3>학생</h3>
          <span class="badge">${students.length}명</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>이름</th><th>학년-반</th><th>번호</th>
                <th>재적</th><th>사용</th><th>최근접속</th><th>관리</th>
              </tr>
            </thead>
            <tbody>
              ${students.length ? students.map(r=>`
                <tr>
                  <td>${esc(r.id)}</td>
                  <td><b>${esc(r.name)}</b></td>
                  <td>${esc(r.grade)}-${esc(r.classNo)}</td>
                  <td>${esc(r.number||'-')}</td>
                  <td>${esc(r.enrollmentState)}</td>
                  <td>${stateBadge(r.state)}</td>
                  <td>${esc(r.lastLogin||'-')}</td>
                  <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button class="btn ghost small admin-action" data-action="student-code" data-id="${esc(r.id)}" type="button">코드 재발급</button>
                      <button class="btn ghost small admin-action" data-action="student-state" data-id="${esc(r.id)}" data-state="${esc(r.state)}" type="button">${r.state==='사용'?'사용중지':'사용복구'}</button>
                      <button class="btn ghost small admin-action" data-action="student-life" data-id="${esc(r.id)}" data-grade="${esc(r.grade)}" data-class="${esc(r.classNo)}" data-enrollment="${esc(r.enrollmentState)}" type="button">재적 변경</button>
                      <button class="btn ghost small admin-action" data-action="student-device" data-id="${esc(r.id)}" type="button">자동접속 해제</button>
                    </div>
                  </td>
                </tr>`).join('')
                : '<tr><td colspan="8" class="empty">학생 없음</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="section-title" style="margin-top:20px">
          <h3>교직원</h3>
          <span class="badge">${staff.length}명</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>이름</th><th>역할</th><th>담당</th>
                <th>재직</th><th>승인</th><th>사용</th><th>관리</th>
              </tr>
            </thead>
            <tbody>
              ${staff.length ? staff.map(r=>`
                <tr>
                  <td>${esc(r.id)}</td>
                  <td><b>${esc(r.name)}</b></td>
                  <td>${esc(r.role)}</td>
                  <td>${esc(staffScopeText(r))}</td>
                  <td>${esc(r.employmentState)}</td>
                  <td>${esc(r.approval)}</td>
                  <td>${stateBadge(r.state)}</td>
                  <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button class="btn ghost small admin-action" data-action="staff-code" data-id="${esc(r.id)}" type="button">코드 재발급</button>
                      <button class="btn ghost small admin-action"
                        data-action="staff-state"
                        data-id="${esc(r.id)}"
                        data-approval="${esc(r.approval)}"
                        data-use="${esc(r.state)}"
                        data-employment="${esc(r.employmentState)}"
                        type="button">상태 관리</button>
                    </div>
                  </td>
                </tr>`).join('')
                : '<tr><td colspan="8" class="empty">교직원 없음</td></tr>'}
            </tbody>
          </table>
        </div>
        <p class="sub" style="margin-top:12px;text-align:right">백엔드 ${esc(data.backendVersion||'확인 안 됨')}</p>`;

      document.querySelectorAll('.admin-action').forEach(btn=>{
        btn.addEventListener('click',()=>handleAdminAction(btn));
      });

    }catch(e){
      if($('sumStudents')) $('sumStudents').textContent='확인 실패';
      if($('sumStaff')) $('sumStaff').textContent='확인 실패';
      $('adminPane').innerHTML=`<div class="notice danger"><b>관리자 데이터 연결 오류</b><br>${esc(e.message||String(e))}</div>`;
    }
  }


  function stateBadge(state){
    const s=String(state||'');
    return `<span class="badge ${s==='사용'?'':'gray'}">${esc(s||'-')}</span>`;
  }


  function staffScopeText(r){
    const parts=[];
    if(r.grade) parts.push(`${r.grade}학년`);
    if(r.classNo) parts.push(`${r.classNo}반`);
    if(r.scope) parts.push(r.scope);
    return parts.join(' ')||'-';
  }


  async function handleAdminAction(btn){
    const action=btn.dataset.action||'';
    const id=btn.dataset.id||'';

    if(action==='student-code') return resetStudentCode(id);
    if(action==='student-state') return toggleStudentUseState(id,btn.dataset.state||'');
    if(action==='student-life') return showStudentLifecycle(
      id,btn.dataset.enrollment||'',btn.dataset.grade||'',btn.dataset.class||''
    );
    if(action==='student-device') return revokeStudentDevicesAdmin(id);
    if(action==='staff-code') return resetStaffCode(id);
    if(action==='staff-state') return showStaffState(
      id,btn.dataset.approval||'',btn.dataset.use||'',btn.dataset.employment||''
    );
  }


  function showCreateStudent(){
    showModal(`
      <div class="modal-head">
        <h3>학생 신규등록</h3>
        <button class="x" onclick="closeModal()">닫기</button>
      </div>
      <p class="sub">학생ID를 비우면 ST-001 형식으로 자동 발급합니다.</p>

      <div class="field"><label>이름</label><input id="newStudentName" autocomplete="off"></div>

      <div class="grid grid2">
        <div class="field"><label>학년</label><input id="newStudentGrade" inputmode="numeric" placeholder="예: 1"></div>
        <div class="field"><label>반</label><input id="newStudentClass" inputmode="numeric" placeholder="예: 1"></div>
      </div>

      <div class="grid grid2">
        <div class="field"><label>번호</label><input id="newStudentNumber" inputmode="numeric" placeholder="예: 3"></div>
        <div class="field"><label>담임ID</label><input id="newStudentHomeroom" placeholder="예: T-01"></div>
      </div>

      <div class="field"><label>학생ID (선택)</label><input id="newStudentId" placeholder="비우면 자동 발급"></div>

      <button class="btn full" id="createStudentSubmit" type="button">등록하기</button>
    `);
    $('createStudentSubmit').onclick=createStudent;
  }


  async function createStudent(){
    if(S.busy) return;
    const args=[
      S.sessionToken,
      ($('newStudentName').value||'').trim(),
      ($('newStudentGrade').value||'').trim(),
      ($('newStudentClass').value||'').trim(),
      ($('newStudentNumber').value||'').trim(),
      ($('newStudentHomeroom').value||'').trim(),
      ($('newStudentId').value||'').trim()
    ];

    S.busy=true;
    $('createStudentSubmit').disabled=true;

    try{
      const res=await window.MI_API.call('adminCreateStudent',args);
      closeModal();
      showIssuedCode('학생 등록 완료',res.studentId,res.name,res.temporaryCode,
        '학생에게 ID와 임시 접속코드를 안전하게 전달해 주세요.');
      await loadAccounts();
    }catch(e){
      toast(e.message||String(e));
      $('createStudentSubmit').disabled=false;
    }finally{
      S.busy=false;
    }
  }


  function showCreateStaff(){
    showModal(`
      <div class="modal-head">
        <h3>교직원 신규등록</h3>
        <button class="x" onclick="closeModal()">닫기</button>
      </div>
      <p class="sub">역할에 따라 교직원ID를 자동 발급할 수 있습니다.</p>

      <div class="field"><label>이름</label><input id="newStaffName" autocomplete="off"></div>

      <div class="field">
        <label>역할</label>
        <select id="newStaffRole">
          <option value="담임">담임</option>
          <option value="교과">교과</option>
          <option value="상담">상담</option>
          <option value="보건">보건</option>
          <option value="관리자">관리자</option>
        </select>
      </div>

      <div class="grid grid2">
        <div class="field"><label>담당학년</label><input id="newStaffGrade" placeholder="예: 1"></div>
        <div class="field"><label>담당반</label><input id="newStaffClass" placeholder="예: 1"></div>
      </div>

      <div class="field"><label>담당범위</label><input id="newStaffScope" placeholder="예: 1-1,1-2 / 전체"></div>
      <div class="field"><label>학교계정(선택)</label><input id="newStaffEmail" type="email" placeholder="name@school.kr"></div>
      <div class="field"><label>교직원ID (선택)</label><input id="newStaffId" placeholder="비우면 자동 발급"></div>

      <button class="btn full" id="createStaffSubmit" type="button">등록하기</button>
    `);
    $('createStaffSubmit').onclick=createStaff;
  }


  async function createStaff(){
    if(S.busy) return;
    const args=[
      S.sessionToken,
      ($('newStaffName').value||'').trim(),
      $('newStaffRole').value,
      ($('newStaffGrade').value||'').trim(),
      ($('newStaffClass').value||'').trim(),
      ($('newStaffScope').value||'').trim(),
      ($('newStaffEmail').value||'').trim(),
      ($('newStaffId').value||'').trim()
    ];

    S.busy=true;
    $('createStaffSubmit').disabled=true;

    try{
      const res=await window.MI_API.call('adminCreateStaff',args);
      closeModal();
      showIssuedCode('교직원 등록 완료',res.staffId,res.name,res.temporaryCode,
        '최초 로그인 후 본인 접속코드로 변경해야 합니다.');
      await loadAccounts();
    }catch(e){
      toast(e.message||String(e));
      $('createStaffSubmit').disabled=false;
    }finally{
      S.busy=false;
    }
  }


  async function resetStudentCode(id){
    if(!confirm(`${id} 학생의 접속코드를 재발급할까요?
기존 자동접속 기기는 모두 해제됩니다.`)) return;
    try{
      const res=await window.MI_API.call('adminResetStudentAccessCode',[S.sessionToken,id]);
      showIssuedCode('학생 접속코드 재발급',res.studentId,'',res.temporaryCode,
        '기존 자동접속 정보는 모두 해제되었습니다.');
      await loadAccounts();
    }catch(e){toast(e.message||String(e));}
  }


  async function resetStaffCode(id){
    if(!confirm(`${id} 교직원의 접속코드를 재발급할까요?`)) return;
    try{
      const res=await window.MI_API.call('adminResetStaffAccessCode',[S.sessionToken,id]);
      showIssuedCode('교직원 접속코드 재발급',res.staffId,'',res.temporaryCode,
        '다음 로그인에서 새 접속코드로 변경하도록 안내해 주세요.');
      await loadAccounts();
    }catch(e){toast(e.message||String(e));}
  }


  function showIssuedCode(title,id,name,code,note){
    showModal(`
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="x" onclick="closeModal()">닫기</button>
      </div>
      <div class="notice">
        <b>${esc(id)}${name?' · '+esc(name):''}</b><br>
        <span class="sub">임시 접속코드는 이번 한 번만 표시됩니다.</span>
      </div>
      <div style="margin:18px 0;padding:18px;border:1px solid #d9e5df;border-radius:14px;text-align:center">
        <div class="sub">임시 접속코드</div>
        <div style="font-size:28px;font-weight:800;letter-spacing:2px;margin-top:5px">${esc(code||'')}</div>
      </div>
      <p class="sub">${esc(note||'')}</p>
      <button class="btn full" id="copyIssuedCodeBtn" type="button">접속코드 복사</button>
    `);

    $('copyIssuedCodeBtn').onclick=async()=>{
      try{
        await navigator.clipboard.writeText(String(code||''));
        toast('접속코드를 복사했습니다.');
      }catch(e){
        toast('복사가 제한되었습니다. 화면의 코드를 직접 복사해 주세요.');
      }
    };
  }


  async function toggleStudentUseState(id,current){
    const next=current==='사용'?'중지':'사용';
    const msg=next==='중지'
      ? `${id} 학생 계정 사용을 중지할까요?
현재 세션과 자동접속 기기도 해제됩니다.`
      : `${id} 학생 계정을 다시 사용할 수 있게 할까요?`;

    if(!confirm(msg)) return;

    try{
      await window.MI_API.call('adminSetStudentUseState',[
        S.sessionToken,id,next,`관리자 화면에서 ${next} 처리`
      ]);
      toast(`학생 계정을 ${next} 상태로 변경했습니다.`);
      await loadAccounts();
    }catch(e){toast(e.message||String(e));}
  }


  function showStudentLifecycle(id,enrollment,grade,classNo){
    const states=['재학','전입','전출','졸업','유예','사망','기타'];
    showModal(`
      <div class="modal-head">
        <h3>학생 재적상태 변경</h3>
        <button class="x" onclick="closeModal()">닫기</button>
      </div>
      <p class="sub">${esc(id)} 학생의 재적상태와 학년·반을 변경합니다.</p>

      <div class="field">
        <label>재적상태</label>
        <select id="lifeState">
          ${states.map(x=>`<option value="${esc(x)}"${x===enrollment?' selected':''}>${esc(x)}</option>`).join('')}
        </select>
      </div>

      <div class="grid grid2">
        <div class="field"><label>학년</label><input id="lifeGrade" value="${esc(grade)}"></div>
        <div class="field"><label>반</label><input id="lifeClass" value="${esc(classNo)}"></div>
      </div>

      <div class="field"><label>메모</label><input id="lifeMemo" placeholder="예: 전출 처리 / 학년 진급"></div>
      <button class="btn full" id="lifeSubmit" type="button">변경 저장</button>
    `);

    $('lifeSubmit').onclick=async()=>{
      try{
        await window.MI_API.call('adminUpdateStudentLifecycle',[
          S.sessionToken,id,$('lifeState').value,
          ($('lifeGrade').value||'').trim(),
          ($('lifeClass').value||'').trim(),
          ($('lifeMemo').value||'').trim()
        ]);
        closeModal();
        toast('학생 재적정보를 변경했습니다.');
        await loadAccounts();
      }catch(e){toast(e.message||String(e));}
    };
  }


  async function revokeStudentDevicesAdmin(id){
    if(!confirm(`${id} 학생의 등록된 자동접속 기기를 모두 해제할까요?`)) return;
    try{
      const res=await window.MI_API.call('adminRevokeStudentDevices',[S.sessionToken,id]);
      toast(`자동접속 기기 ${res.count||0}개를 해제했습니다.`);
      await loadAccounts();
    }catch(e){toast(e.message||String(e));}
  }


  function showStaffState(id,approval,use,employment){
    const approvalOpts=['승인','대기','반려'];
    const useOpts=['사용','중지'];
    const employmentOpts=['재직','휴직','퇴직'];

    const opts=(arr,current)=>arr.map(x=>`<option value="${esc(x)}"${x===current?' selected':''}>${esc(x)}</option>`).join('');

    showModal(`
      <div class="modal-head">
        <h3>교직원 상태 관리</h3>
        <button class="x" onclick="closeModal()">닫기</button>
      </div>
      <p class="sub">${esc(id)} 계정 상태를 변경합니다.</p>

      <div class="field"><label>승인상태</label><select id="staffApproval">${opts(approvalOpts,approval)}</select></div>
      <div class="field"><label>사용상태</label><select id="staffUse">${opts(useOpts,use)}</select></div>
      <div class="field"><label>재직상태</label><select id="staffEmployment">${opts(employmentOpts,employment)}</select></div>
      <div class="field"><label>메모</label><input id="staffStateMemo" placeholder="상태 변경 사유"></div>

      <button class="btn full" id="staffStateSubmit" type="button">변경 저장</button>
    `);

    $('staffStateSubmit').onclick=async()=>{
      try{
        await window.MI_API.call('adminSetStaffState',[
          S.sessionToken,id,
          $('staffApproval').value,
          $('staffUse').value,
          $('staffEmployment').value,
          ($('staffStateMemo').value||'').trim()
        ]);
        closeModal();
        toast('교직원 계정 상태를 변경했습니다.');
        await loadAccounts();
      }catch(e){toast(e.message||String(e));}
    };
  }


  function renderStudentMiniList(list){
    if(!list.length) return '<div class="empty">현재 접근 가능한 학생이 없습니다.</div>';
    return `<div class="list">${list.slice(0,12).map(s=>`<div class="row"><div><b>${esc(s.name)}</b><br><small>${esc(s.grade)}-${esc(s.classNo)} ${esc(s.number||'')}번</small></div><span class="badge ${s.accessLevel==='sensitive'?'':'gray'}">${s.accessLevel==='sensitive'?'지원권한':'기본정보'}</span></div>`).join('')}</div>${list.length>12?`<p class="sub">외 ${list.length-12}명</p>`:''}`;
  }

  function showChangeCode(forced){
    showModal(`
      <div class="modal-head"><h3>${forced?'첫 접속코드 변경':'내 접속코드 변경'}</h3>${forced?'':'<button class="x" onclick="closeModal()">닫기</button>'}</div>
      <p class="sub">${forced?'관리자·교직원 임시 접속코드는 첫 로그인 후 변경해야 합니다.':''}</p>
      <div class="field"><label>현재 접속코드</label><input id="oldCode" type="password"></div>
      <div class="field"><label>새 접속코드</label><input id="newCode" type="password" placeholder="학생 6자 이상 / 교직원 8자 이상"></div>
      <button class="btn full" id="changeCodeSubmit">변경하기</button>`);
    $('changeCodeSubmit').onclick=()=>changeCode(forced);
  }

  async function changeCode(forced){
    try{
      const res=await window.MI_API.call('changeMyAccessCode',[S.sessionToken,($('oldCode').value||'').trim(),($('newCode').value||'').trim()]);
      if(S.user?.role==='student'){ clearDeviceToken(); clearQuickWriteToken(); }
      closeModal(); toast(res.message||'접속코드를 변경했습니다.');
      if(forced){
        S.home=res.home || await window.MI_API.call('getHome',[S.sessionToken]);
        S.user=S.home.user; S.config=S.home.config||S.config; renderHome(false);
      }
    }catch(e){toast(e.message||String(e));}
  }

  async function revokeCurrentDevice(){
    const dt=getDeviceToken(); if(!dt) return;
    if(!confirm('이 기기의 자동접속을 해제할까요? 다음 접속부터 아이디와 접속코드를 다시 입력합니다.')) return;
    try{
      await window.MI_API.call('revokeMyDevice',[S.sessionToken,dt]);
      clearDeviceToken(); clearQuickWriteToken(); toast('이 기기의 자동접속을 해제했습니다.'); renderStudentHome(false);
    }catch(e){toast(e.message||String(e));}
  }

  async function logout(){
    const token=S.sessionToken; S.sessionToken=''; S.user=null; S.home=null; S.pendingMood='';
    try{if(token) await window.MI_API.call('logout',[token]);}catch(e){}
    $('userPill').classList.add('hidden'); $('exitBtn').classList.add('hidden');
    renderLogin();
  }

  function changeSchool(){
    localStorage.removeItem('mi_school_code');
    clearQuickWriteToken();
    S.schoolCode='';S.school=null;S.config=null;S.sessionToken='';S.user=null;S.home=null;S.pendingMood='';
    window.MI_API.disconnect(); renderSchoolGate();
  }

  function setHeader(connected){
    if(!connected){$('schoolPill').classList.add('hidden');$('userPill').classList.add('hidden');$('exitBtn').classList.add('hidden');return;}
    $('schoolPill').textContent=S.config?.schoolName||S.school?.name||'';
    $('schoolPill').classList.remove('hidden');
  }

  function getDeviceKey(){return 'mi_device_token_'+(S.schoolCode||'').toUpperCase();}
  function getDeviceToken(){return localStorage.getItem(getDeviceKey())||'';}
  function setDeviceToken(v){localStorage.setItem(getDeviceKey(),String(v||''));}
  function clearDeviceToken(){localStorage.removeItem(getDeviceKey());}
  function getDeviceAlias(){
    const ua=navigator.userAgent||'';
    if(/Android/i.test(ua)) return 'Android 개인기기';
    if(/iPhone|iPad|iPod/i.test(ua)) return 'iOS 개인기기';
    if(/Windows/i.test(ua)) return 'Windows 개인기기';
    return '개인기기';
  }


  // ---------------------------------------------------------------------------
  // Hybrid 0.1.6.2 quick mood write
  // ---------------------------------------------------------------------------

  function quickTokenKey(){return 'mi_quick_write_'+(S.schoolCode||'').toUpperCase();}
  function getQuickWriteToken(){return localStorage.getItem(quickTokenKey())||'';}
  function setQuickWriteToken(v){
    S.quickWriteToken=String(v||'');
    if(S.quickWriteToken) localStorage.setItem(quickTokenKey(),S.quickWriteToken);
  }
  function clearQuickWriteToken(){
    S.quickWriteToken='';
    localStorage.removeItem(quickTokenKey());
  }

  function localDayKey(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${y}${m}${day}`;
  }
  function moodRecordKey(){return `mi_mood_record_${(S.schoolCode||'').toUpperCase()}_${localDayKey()}`;}
  function pendingMoodKey(){return `mi_pending_mood_${(S.schoolCode||'').toUpperCase()}`;}

  function randomRecordId(){
    let r='';
    if(window.crypto && crypto.randomUUID) r=crypto.randomUUID().replace(/-/g,'').toUpperCase();
    else r=(Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)).toUpperCase();
    return 'QMOOD-'+r.slice(0,40);
  }

  function getTodayRecordId(){
    let id=localStorage.getItem(moodRecordKey())||'';
    if(!/^QMOOD-[A-Z0-9_-]{8,72}$/.test(id)){
      id=randomRecordId();
      localStorage.setItem(moodRecordKey(),id);
    }
    return id;
  }

  function setPendingMoodRecord(mood){
    const rec={
      recordId:getTodayRecordId(),
      mood:String(mood||''),
      clientAt:new Date().toISOString(),
      day:localDayKey()
    };
    // 민감정보 최소화: 이름/학생ID/메모는 저장하지 않고 전송 전의 감정 코드만 잠시 저장합니다.
    localStorage.setItem(pendingMoodKey(),JSON.stringify(rec));
    return rec;
  }

  function getPendingMoodRecord(){
    try{
      const raw=localStorage.getItem(pendingMoodKey());
      if(!raw) return null;
      const rec=JSON.parse(raw);
      if(!rec || rec.day!==localDayKey() || !rec.recordId || !rec.mood){
        localStorage.removeItem(pendingMoodKey());
        return null;
      }
      return rec;
    }catch(e){
      localStorage.removeItem(pendingMoodKey());
      return null;
    }
  }

  function clearPendingMoodRecord(recordId){
    const rec=getPendingMoodRecord();
    if(!rec || !recordId || rec.recordId===recordId) localStorage.removeItem(pendingMoodKey());
  }

  function quickPostParams(rec){
    const p=new URLSearchParams();
    p.set('action','quickMood');
    p.set('quickToken',getQuickWriteToken());
    p.set('deviceToken',getDeviceToken()); // 0.1.3→0.1.4 첫 전환 때만 fallback
    p.set('recordId',rec.recordId);
    p.set('mood',rec.mood);
    return p;
  }

  function fireQuickBeacon(rec){
    if(!rec || !S.school?.bridgeUrl) return false;
    if(!getQuickWriteToken() && !getDeviceToken()) return false;

    const url=S.school.bridgeUrl;
    const params=quickPostParams(rec);

    try{
      if(navigator.sendBeacon){
        const queued=navigator.sendBeacon(url,params);
        if(queued) return true;
      }
    }catch(e){}

    // sendBeacon을 사용할 수 없는 브라우저용 fallback.
    try{
      fetch(url,{
        method:'POST',
        body:params,
        mode:'no-cors',
        credentials:'omit',
        keepalive:true,
        cache:'no-store'
      }).catch(()=>{});
      return true;
    }catch(e){
      return false;
    }
  }

  async function submitQuickMood(mood){
    const rec=setPendingMoodRecord(mood);
    updateMoodSaveStatus('전송을 시작했어요. 창을 닫아도 계속 시도합니다.','sending');

    // Bridge 연결 여부와 관계없이 먼저 unload-safe 전송을 큐에 넣습니다.
    const queued=fireQuickBeacon(rec);
    if(!queued){
      updateMoodSaveStatus('기록을 잠시 보관했어요. 학교 서버가 연결되면 다시 보냅니다.','queued');
    }

    // Bridge가 이미 준비된 경우 같은 recordId로 확인용 RPC도 보냅니다.
    // 서버는 upsert하므로 Beacon과 RPC가 둘 다 도착해도 한 행만 유지됩니다.
    if(window.MI_API && window.MI_API.bridgeWindow){
      try{
        const res=await window.MI_API.call('quickSaveMood',[
          getQuickWriteToken(),getDeviceToken(),rec.recordId,rec.mood
        ]);
        if(res && res.ok){
          clearPendingMoodRecord(rec.recordId);
          updateMoodSaveStatus('오늘 마음을 안전하게 저장했어요 ✓','saved');
          return;
        }
      }catch(e){
        updateMoodSaveStatus('전송을 계속 시도하고 있어요. 다음 접속 때도 자동으로 확인합니다.','queued');
      }
    }
  }

  async function flushPendingMoodRpc(){
    const rec=getPendingMoodRecord();
    if(!rec) return;
    if(!window.MI_API || !window.MI_API.bridgeWindow) return;

    // quick token은 resume/login 응답에서 갱신됩니다.
    S.quickWriteToken=getQuickWriteToken();
    try{
      const res=await window.MI_API.call('quickSaveMood',[
        getQuickWriteToken(),getDeviceToken(),rec.recordId,rec.mood
      ]);
      if(res && res.ok){
        clearPendingMoodRecord(rec.recordId);
        updateMoodSaveStatus('오늘 마음을 안전하게 저장했어요 ✓','saved');
      }
    }catch(e){
      fireQuickBeacon(rec);
      updateMoodSaveStatus('기록을 다시 전송하고 있어요.','queued');
    }
  }

  function flushPendingMoodBeacon(){
    const rec=getPendingMoodRecord();
    if(rec) fireQuickBeacon(rec);
  }

  function updateMoodSaveStatus(text,state){
    const pairs=[
      ['moodSaveStatus','moodSaveText'],
      ['homeMoodSaveStatus','homeMoodSaveText']
    ];
    pairs.forEach(([boxId,textId])=>{
      const box=$(boxId), label=$(textId);
      if(!box||!label) return;
      box.classList.remove('idle','sending','queued','saved','error');
      box.classList.add(state||'idle');
      label.textContent=text||'';
    });
  }

  function reflectPendingMoodState(){
    const rec=getPendingMoodRecord();
    if(rec){
      S.pendingMood=rec.mood;
      const selected=document.querySelector(`.mood-btn[data-mood="${CSS.escape(rec.mood)}"]`);
      if(selected) selected.classList.add('selected');
      if(rec.mood==='skip' && $('homeSkipMoodBtn')) $('homeSkipMoodBtn').classList.add('selected');
      updateMoodSaveStatus('저장 확인을 기다리는 기록이 있어요. 자동으로 다시 전송합니다.','queued');
      fireQuickBeacon(rec);
      flushPendingMoodRpc();
    }
  }

  function showModal(html){$('modalBody').innerHTML=html;$('modal').classList.remove('hidden');}
  window.closeModal=function(){$('modal').classList.add('hidden');$('modalBody').innerHTML='';};
  window.toast=toast;
  function toast(msg){const el=$('toast');el.textContent=String(msg||'');el.classList.remove('hidden');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.add('hidden'),3500);}
  function elapsedSec(start){return Math.max(0,(performance.now()-start)/1000).toFixed(1);}
  function resServer(res){return res&&Number.isFinite(Number(res.serverMs))?` · 서버 ${(Number(res.serverMs)/1000).toFixed(1)}초`:'';}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
})();