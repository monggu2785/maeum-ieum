(() => {
  const pending = new Map();
  let frame = null;
  let ready = false;
  let readyPromise = null;
  let resolveReady = null;
  let rejectReady = null;
  let seq = 0;

  function connect(execUrl) {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const origin = window.location.origin;
    const url = execUrl + (execUrl.includes('?') ? '&' : '?') +
      'mode=bridge&origin=' + encodeURIComponent(origin) + '&t=' + Date.now();

    frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.border = '0';
    frame.src = url;
    document.body.appendChild(frame);

    const timer = setTimeout(() => {
      if (!ready && rejectReady) rejectReady(new Error('학교 서버 연결 시간이 길어지고 있습니다. 다시 시도해 주세요.'));
    }, 25000);
    readyPromise.finally(() => clearTimeout(timer));
    return readyPromise;
  }

  function call(method, args = []) {
    if (!readyPromise) return Promise.reject(new Error('학교 서버 연결을 먼저 시작해 주세요.'));
    return readyPromise.then(() => new Promise((resolve, reject) => {
      const id = 'c' + Date.now() + '_' + (++seq);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('처리 시간이 길어지고 있습니다. 잠시 후 다시 시도해 주세요.'));
      }, 25000);
      pending.set(id, { resolve, reject, timer });
      frame.contentWindow.postMessage({ type: 'MI_API_CALL', id, method, args }, '*');
    }));
  }

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow) return;
    const msg = event.data || {};
    if (msg.type === 'MI_BRIDGE_READY') {
      ready = true;
      if (resolveReady) resolveReady({ ok: true, version: msg.version || '' });
      return;
    }
    if (msg.type !== 'MI_API_RESULT' || !msg.id) return;
    const item = pending.get(msg.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(msg.id);
    if (msg.ok) item.resolve(msg.result);
    else item.reject(new Error(msg.error || '처리 중 오류가 발생했습니다.'));
  });

  window.MI_API = { connect, call, isReady: () => ready };
})();
