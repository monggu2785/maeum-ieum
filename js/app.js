(() => {
  'use strict';

  const S = {schoolCode:'', school:null, config:null, sessionToken:'', user:null, home:null, busy:false};
  const $ = id => document.getElementById(id);
  const main = () => $('main');

  document.addEventListener('DOMContentLoaded', init);

  function init(){
    $('exitBtn').addEventListener('click', logout);
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
        <div class="notice warn"><b>Hybrid 0.1.2 학생 빠른접속 시험판</b><br><span class="sub">현재는 학교 연결·로그인·학생 개인기기 자동접속 기반을 검증하는 단계입니다. 실제 학생 마음기록 운영에는 아직 사용하지 않습니다.</span></div>
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

    S.schoolCode = code; S.school = school;
    renderConnecting(school.name);
    try {
      const cfg = await window.MI_API.connect(school.bridgeUrl, code);
      S.config = cfg;
      localStorage.setItem('mi_school_code',code);
      setHeader(true);
      const deviceToken = getDeviceToken();
      if (deviceToken) {
        const speedStart = performance.now();
        try {
          const resumed = await window.MI_API.call('resumeStudent',[deviceToken]);
          await acceptLogin(resumed, true);
          toast(`자동접속 완료 · ${elapsedSec(speedStart)}초${resServer(resumed)}`);
          return;
        } catch (e) {
          clearDeviceToken();
          toast('자동접속 기간이 끝났습니다. 한 번만 다시 로그인해 주세요.');
        }
      }
      renderLogin();
    } catch (e) {
      renderConnectionError(e.message || String(e));
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
    main().innerHTML=`<section class="card hero"><span class="school-badge">${esc(name)}</span><h2>마음이음을 준비하고 있어요</h2><div class="loading"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div><p class="sub">화면은 먼저 열고, 필요한 학교 데이터만 한 번에 안전하게 연결합니다.</p></section>`;
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

  function renderLogin(){
    const cfg = S.config || {};
    main().innerHTML=`
      <section class="card hero">
        <span class="school-badge">${esc(cfg.schoolName || S.school?.name || '')}</span>
        <h2>반가워요</h2>
        <p class="sub">처음에는 발급받은 아이디와 접속코드를 입력합니다.</p>
        <div class="field"><label>아이디</label><input id="loginId" autocomplete="username" placeholder="예: ST-001 / T-01 / A-01"></div>
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

  async function doLogin(){
    if (S.busy) return;
    const id=($('loginId').value||'').trim();
    const code=($('loginCode').value||'').trim();
    const remember=$('rememberDevice').checked;
    if(!id||!code) return toast('아이디와 접속코드를 입력해 주세요.');

    const speedStart=performance.now();
    setBusy(true,'loginBtn','마음이음을 여는 중...');
    try{
      const res=await window.MI_API.call('login',[id,code,remember,getDeviceAlias()]);
      if(res.deviceToken) setDeviceToken(res.deviceToken);
      $('loginCode').value='';
      await acceptLogin(res,false);
      if(!res.mustChangeCode) toast(`접속 완료 · ${elapsedSec(speedStart)}초${resServer(res)}`);
    }catch(e){toast(e.message||String(e));}
    finally{setBusy(false,'loginBtn','접속하기');}
  }

  async function acceptLogin(res, auto){
    S.sessionToken=res.token; S.user=res.user;
    setHeader(true);
    if(res.mustChangeCode){ showChangeCode(true); return; }

    try{
      // 0.1.1: 로그인/자동접속 응답에 home이 포함되므로
      // 정상 경로에서는 getHome()을 다시 호출하지 않습니다.
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
      <div class="home-head"><h2>${esc(s.name)}님, 안녕하세요</h2><p>${esc(s.grade)}학년 ${esc(s.classNo)}반${s.number?' '+esc(s.number)+'번':''}${auto?' · 자동접속됨':''}</p></div>
      <div class="grid grid2">
        <section class="big-action">
          <div class="emoji">🌿</div><h3>오늘의 마음</h3>
          <p class="sub">다음 단계에서 이곳이 학생의 첫 화면이 됩니다. 5~10초 안에 마음 상태를 남기고 바로 나갈 수 있도록 만들 예정입니다.</p>
          <button class="btn secondary" type="button" onclick="toast('오늘의 마음 기능은 Hybrid 0.2에서 연결합니다.')">다음 단계 미리보기</button>
        </section>
        <section class="card">
          <div class="section-title"><h3>개인기기 접속</h3><span class="badge">${getDeviceToken()?'자동접속 사용':'일반접속'}</span></div>
          <p class="sub">학생 ID와 접속코드를 매번 입력하지 않도록 개인기기에 안전한 무작위 기기 토큰만 보관합니다.</p>
          ${getDeviceToken()?'<button class="btn ghost" type="button" id="revokeDeviceBtn">이 기기 자동접속 해제</button>':''}
        </section>
      </div>
      <section class="card" style="margin-top:15px">
        <div class="section-title"><h3>0.1 연결 확인</h3><span class="badge">정상</span></div>
        <div class="notice">GitHub 화면 → 학교별 Apps Script → 학교별 Google Sheet 연결이 정상적으로 작동하고 있습니다.</div>
      </section>`;
    if($('revokeDeviceBtn')) $('revokeDeviceBtn').onclick=revokeCurrentDevice;
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
      <div class="home-head"><h2>${esc(S.home.user.name)}님</h2><p>마음이음 학교 관리자 · Hybrid 0.1.1</p></div>
      <div class="grid grid3">
        <section class="card"><h3>학교별 독립 DB</h3><p class="sub">이 학교의 학생·학부모·교직원 데이터는 이 학교의 Google Sheet에 저장됩니다.</p></section>
        <section class="card"><h3>학생 자동접속</h3><p class="sub">개인기기 토큰은 학생 계정에만 발급하며 전출·졸업·사망·사용중지 시 자동 해제됩니다.</p></section>
        <section class="card"><h3>상담정보 분리</h3><p class="sub">관리자 권한과 민감한 상담정보 열람권한은 분리하는 원칙을 유지합니다.</p></section>
      </div>
      <section class="card" style="margin-top:15px">
        <div class="section-title"><h3>기반 기능 테스트</h3><span class="badge">0.1.1</span></div>
        <div class="grid grid2"><button class="btn" id="accountBtn">학생·교직원 현황 불러오기</button><button class="btn secondary" id="changeCodeBtn">내 접속코드 변경</button></div>
        <div id="adminPane" style="margin-top:14px"></div>
      </section>`;
    $('accountBtn').onclick=loadAccounts;
    $('changeCodeBtn').onclick=()=>showChangeCode(false);
  }

  async function loadAccounts(){
    $('adminPane').innerHTML='<div class="loading"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>';
    try{
      const data=await window.MI_API.call('adminListAccounts',[S.sessionToken]);
      const students=data.students||[], staff=data.staff||[];
      $('adminPane').innerHTML=`
        <div class="section-title"><h3>학생</h3><span class="badge">${students.length}명</span></div>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>이름</th><th>학년-반</th><th>재적</th><th>사용</th><th>최근접속</th></tr></thead><tbody>${students.length?students.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.grade)}-${esc(r.classNo)}</td><td>${esc(r.enrollmentState)}</td><td>${esc(r.state)}</td><td>${esc(r.lastLogin||'-')}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">학생 없음</td></tr>'}</tbody></table></div>
        <div class="section-title" style="margin-top:16px"><h3>교직원</h3><span class="badge">${staff.length}명</span></div>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>이름</th><th>역할</th><th>재직</th><th>승인</th><th>사용</th></tr></thead><tbody>${staff.length?staff.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${esc(r.employmentState)}</td><td>${esc(r.approval)}</td><td>${esc(r.state)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">교직원 없음</td></tr>'}</tbody></table></div>`;
    }catch(e){$('adminPane').innerHTML=`<div class="notice danger">${esc(e.message||String(e))}</div>`;}
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
      if(S.user?.role==='student') clearDeviceToken();
      closeModal(); toast(res.message||'접속코드를 변경했습니다.');
      if(forced){
        // 0.1.1: 코드변경 응답에도 home을 함께 받아 추가 왕복을 없앱니다.
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
      clearDeviceToken(); toast('이 기기의 자동접속을 해제했습니다.'); renderStudentHome(false);
    }catch(e){toast(e.message||String(e));}
  }

  async function logout(){
    const token=S.sessionToken; S.sessionToken=''; S.user=null; S.home=null;
    try{if(token) await window.MI_API.call('logout',[token]);}catch(e){}
    $('userPill').classList.add('hidden'); $('exitBtn').classList.add('hidden');
    renderLogin();
  }

  function changeSchool(){
    localStorage.removeItem('mi_school_code');
    S.schoolCode='';S.school=null;S.config=null;S.sessionToken='';S.user=null;S.home=null;
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

  function showModal(html){$('modalBody').innerHTML=html;$('modal').classList.remove('hidden');}
  window.closeModal=function(){$('modal').classList.add('hidden');$('modalBody').innerHTML='';};
  window.toast=toast;
  function toast(msg){const el=$('toast');el.textContent=String(msg||'');el.classList.remove('hidden');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.add('hidden'),3500);}
  function setBusy(v,id,text){S.busy=v;const b=$(id);if(b){b.disabled=v;b.textContent=text;}}
  function elapsedSec(start){return Math.max(0,(performance.now()-start)/1000).toFixed(1);}
  function resServer(res){return res&&Number.isFinite(Number(res.serverMs))?` · 서버 ${(Number(res.serverMs)/1000).toFixed(1)}초`:'';}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
})();
