const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const source = fs.readFileSync(require.resolve('../background.js'), 'utf8');

function setup(saved = {}) {
  const listeners = [], timers = [], refreshed = [];
  let now = 1000, text = 'first', safe = true, reloaded = 0;
  const tab = { id: 1, url: 'https://www.twitch.tv/darumarum' };
  vm.runInNewContext(source, {
    chrome: { runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path,
      onMessage: { addListener: fn => listeners.push(fn) }, reload() { reloaded++; } },
      storage: { local: { async get(key) { return { [key]: saved[key] }; }, async set(values) { Object.assign(saved, values); } } },
      tabs: { async query() { return [tab]; }, async get() { return tab; },
        async sendMessage() { return { safe }; }, async reload(id) { refreshed.push(id); } } },
    crypto, TextEncoder, Uint8Array, Date: { now: () => now },
    setTimeout: fn => timers.push(fn),
    async fetch(url) {
      assert.ok(url.startsWith('chrome-extension://test/'));
      return { ok: true, async json() { return { enabled: true, files: ['background.js'] }; }, async text() { return text; } };
    }
  });
  return { saved, timers, refreshed, set text(value) { text = value; }, set safe(value) { safe = value; },
    get reloaded() { return reloaded; },
    async poll(time) { now = time; return new Promise(resolve => {
      for (const listener of listeners) if (listener({ type: 'TCC_DEV_RELOAD_POLL' }, { id: 'test', tab }, resolve)) break;
    }); } };
}
test('a stable local file change reloads the extension once and restores only matching Twitch tabs', async () => {
  const app = setup();
  assert.equal((await app.poll(1000)).enabled, true);
  app.text = 'changed';
  await app.poll(3000);
  assert.equal(app.timers.length, 0);
  assert.equal((await app.poll(5000)).reloading, true);
  app.timers.shift()();
  assert.equal(app.reloaded, 1);
  const restored = setup(app.saved); restored.text = 'changed';
  await restored.poll(7000);
  assert.deepEqual(restored.refreshed, [1]);
  assert.equal(restored.saved.tcc_dev_reload.tabs, undefined);
  assert.equal(restored.reloaded, 0);
});
test('a draft or active interaction postpones automatic reload', async () => {
  const app = setup(); await app.poll(1000);
  app.text = 'changed'; app.safe = false;
  await app.poll(3000);
  assert.equal((await app.poll(5000)).waiting, true);
  assert.equal(app.timers.length, 0);
  app.safe = true;
  assert.equal((await app.poll(7000)).reloading, true);
});

