(() => {
  'use strict';

  const BRIDGE = 'MAEUM_IEUM_BRIDGE_V1';
  const GOOGLE_ORIGIN_RE = /^https:\/\/(?:script\.google\.com|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.googleusercontent\.com)$/i;

  class MaeumIeumBridgeApi {
    constructor(){
      this.iframe = null;
      this.bridgeWindow = null;
      this.bridgeOrigin = '';
      this.schoolCode = '';
      this.pending = new Map();
      this.readyPromise = null;
      this._onMessage = this._onMessage.bind(this);
      window.addEventListener('message', this._onMessage);
    }

    async connect(execUrl, schoolCode){
      this.disconnect();
      this.schoolCode = String(schoolCode || '').toUpperCase();

      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/i.test(execUrl || '')) {
        throw new Error('학교의 Apps Script /exec 주소가 아직 등록되지 않았습니다.');
      }

      this.readyPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Google 서버 연결 시간이 초과되었습니다. Apps Script 배포 주소와 접근 권한을 확인해 주세요.')), 20000);
        this._readyResolve = payload => { clearTimeout(timer); resolve(payload); };
        this._readyReject = error => { clearTimeout(timer); reject(error); };
      });

      const iframe = document.createElement('iframe');
      iframe.id = 'miBridgeFrame';
      iframe.title = '마음이음 Google 연결';
      iframe.setAttribute('aria-hidden','true');
      iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none;';
      const join = execUrl.includes('?') ? '&' : '?';
      iframe.src = execUrl + join + 'mode=bridge&_=' + Date.now();
      document.body.appendChild(iframe);
      this.iframe = iframe;

      const ready = await this.readyPromise;
      if (String(ready.schoolCode || '').toUpperCase() !== this.schoolCode) {
        this.disconnect();
        throw new Error('학교코드와 연결된 Google 데이터가 서로 다릅니다. 학교 설정을 확인해 주세요.');
      }

      const cfg = await this.call('getPublicConfig', []);
      if (String(cfg.schoolCode || '').toUpperCase() !== this.schoolCode) {
        throw new Error('학교 설정 확인에 실패했습니다.');
      }
      return cfg;
    }

    disconnect(){
      if (this.iframe) this.iframe.remove();
      this.iframe = null;
      this.bridgeWindow = null;
      this.bridgeOrigin = '';
      this.schoolCode = '';
      this.pending.forEach(p => p.reject(new Error('연결이 종료되었습니다.')));
      this.pending.clear();
    }

    call(method, args = []){
      if (!this.bridgeWindow || !this.bridgeOrigin) return Promise.reject(new Error('Google 서버가 아직 연결되지 않았습니다.'));
      const id = 'rpc-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('요청 처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'));
        }, 25000);
        this.pending.set(id,{resolve,reject,timer});
        this.bridgeWindow.postMessage({bridge:BRIDGE,type:'rpc',id,method,args},this.bridgeOrigin);
      });
    }

    _onMessage(event){
      const msg = event.data || {};
      if (msg.bridge !== BRIDGE) return;
      if (!GOOGLE_ORIGIN_RE.test(event.origin)) return;

      if (msg.type === 'ready') {
        if (this.schoolCode && String(msg.schoolCode || '').toUpperCase() !== this.schoolCode) return;
        this.bridgeWindow = event.source;
        this.bridgeOrigin = event.origin;
        if (this._readyResolve) this._readyResolve(msg);
        return;
      }

      if (msg.type === 'rpc-result' && msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || '서버 처리 중 오류가 발생했습니다.'));
      }
    }
  }

  window.MI_API = new MaeumIeumBridgeApi();
})();
