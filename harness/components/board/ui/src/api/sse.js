export function initLiveSync(onEvent) {
  if (typeof EventSource === 'undefined') return null;

  try {
    const sse = new EventSource('/api/v1/events');

    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg && msg.type !== 'connected') {
          if (typeof onEvent === 'function') {
            onEvent(msg);
          }
        }
      } catch (_) {}
    };

    sse.onerror = () => {
      // Native auto-reconnect handled by browser EventSource
    };

    return sse;
  } catch (err) {
    console.warn('SSE live sync unavailable:', err);
    return null;
  }
}
