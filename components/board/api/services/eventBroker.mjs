export class EventBroker {
  constructor({ keepaliveIntervalMs = 15000 } = {}) {
    this.clients = new Set();
    this.keepaliveIntervalMs = keepaliveIntervalMs;

    if (keepaliveIntervalMs > 0) {
      this.timer = setInterval(() => {
        this.sendKeepalive();
      }, keepaliveIntervalMs);
      if (this.timer.unref) {
        this.timer.unref();
      }
    }
  }

  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
    this.clients.add(res);

    req.on('close', () => {
      this.removeClient(res);
    });
  }

  removeClient(res) {
    this.clients.delete(res);
  }

  broadcastChange(type, data = {}) {
    const payload = `data: ${JSON.stringify({ type, data, ts: Date.now() })}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (_) {
        this.clients.delete(client);
      }
    }
  }

  sendKeepalive() {
    const comment = ':keepalive\n\n';
    for (const client of this.clients) {
      try {
        client.write(comment);
      } catch (_) {
        this.clients.delete(client);
      }
    }
  }

  close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const client of this.clients) {
      try {
        client.end();
      } catch (_) {}
    }
    this.clients.clear();
  }
}
