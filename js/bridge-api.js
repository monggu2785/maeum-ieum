(() => {
  const pending = new Map();
  let execUrl = '';
  let seq = 0;

  function connect(url) {
    execUrl = String(url || '').trim();
    if (!execUrl) return Promise.reject(new Error('학교 서버 주소가 설정되지 않았습니다.'));
    // Phase 2.1: 별도의 지속 브리지 준비를 기다리지 않는다.
    return Promise.resolve({ ok: true, version: 'rpc-post' });
  }

  function call(method, args = []) {
    if (!execUrl) return Promise.reject(new Error('학교 서버 연결을 먼저 시작해 주세요.'));

    return new Promise((resolve, reject) => {
      const id = 'rpc_' + Date.now() + '_' + (++seq);
      const channel = makeChannel();
      const frameName = 'mi_rpc_frame_' + id.replace(/[^A-Za-z0-9_]/g, '');

      const frame = document.createElement('iframe');
      frame.name = frameName;
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.position = 'fixed';
      frame.style.width = '1px';
      frame.style.height = '1px';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      frame.style.border = '0';
      document.body.appendChild(frame);

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = execUrl;
      form.target = frameName;
      form.style.display = 'none';

      const fields = {
        transport: 'rpc',
        origin: window.location.origin,
        id,
        channel,
        method: String(method || ''),
        args: JSON.stringify(Array.isArray(args) ? args : [])
      };
      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);

      const timer = setTimeout(() => {
        cleanup(id);
        reject(new Error('학교 서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.'));
      }, 30000);

      pending.set(id, { resolve, reject, timer, frame, form, channel });
      try {
        form.submit();
        // submit 후 form은 제거해도 전송은 계속된다.
        setTimeout(() => { try { form.remove(); } catch (_) {} }, 0);
      } catch (err) {
        cleanup(id);
        reject(new Error('학교 서버 요청을 보낼 수 없습니다.'));
      }
    });
  }

  function cleanup(id) {
    const item = pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    try { item.form && item.form.remove(); } catch (_) {}
    try { item.frame && item.frame.remove(); } catch (_) {}
    pending.delete(id);
  }

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'MI_RPC_RESULT' || !msg.id) return;
    const item = pending.get(msg.id);
    if (!item || msg.channel !== item.channel) return;

    const resolve = item.resolve;
    const reject = item.reject;
    cleanup(msg.id);
    if (msg.ok) resolve(msg.result);
    else reject(new Error(msg.error || '처리 중 오류가 발생했습니다.'));
  });

  function makeChannel() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID() + crypto.randomUUID();
    const a = new Uint32Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 0xffffffff);
    return Array.from(a, n => n.toString(16).padStart(8, '0')).join('');
  }

  window.MI_API = {
    connect,
    call,
    isReady: () => !!execUrl
  };
})();
