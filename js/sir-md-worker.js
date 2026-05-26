// js/sir-md-worker.js
//
// Purpose: Parse Markdown -> HTML using marked.js in a Web Worker.
//
// Messages:
//  - { type: 'init', id, markedUrl }
//  - { type: 'render', id, md }
//
// Responses:
//  - { type: 'init', id, ok, error? }
//  - { type: 'render', id, ok, html?, error? }

let READY = false;

function reply(type, id, payload) {
  self.postMessage({ type, id, ...payload });
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  const type = msg.type;
  const id = msg.id;

  if (!type || !id) {
    // Ignore malformed messages (or you could reply with an error)
    return;
  }

  if (type === 'init') {
    try {
      if (!msg.markedUrl) throw new Error('markedUrl missing');

      // Load marked into the worker global scope.
      importScripts(msg.markedUrl);

      if (!self.marked || typeof self.marked.parse !== 'function') {
        throw new Error('marked did not load or has no parse()');
      }

      READY = true;
      reply('init', id, { ok: true });
    } catch (err) {
      READY = false;
      reply('init', id, { ok: false, error: String(err) });
    }
    return;
  }

  if (type === 'render') {
    if (!READY) {
      reply('render', id, { ok: false, error: 'Worker not initialized' });
      return;
    }
    try {
      const md = msg.md ?? '';
      const html = self.marked.parse(md);
      reply('render', id, { ok: true, html });
    } catch (err) {
      reply('render', id, { ok: false, error: String(err) });
    }
    return;
  }

  // Unknown message type
  reply(type, id, { ok: false, error: `Unknown message type: ${type}` });
};
