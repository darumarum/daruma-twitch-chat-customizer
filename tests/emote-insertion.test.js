const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the real bridge message listener with a controlled React textarea.
function setup(value, start, end, controlled) {
  let listener;
  const messages = [];
  class Textarea {
    constructor() {
      this.tagName = 'TEXTAREA'; this.isConnected = true;
      this.selectionStart = start; this.selectionEnd = end;
      this.style = {}; this.attrs = {}; this.value = value;
    }
    get value() { return this._value; }
    set value(next) { this._value = next; }
    getBoundingClientRect() { return { width: 200, height: 40 }; }
    focus() {}
    getAttribute(key) { return this.attrs[key]; }
    setAttribute(key, val) { this.attrs[key] = val; }
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    dispatchEvent() {}
  }
  const textarea = new Textarea();
  if (controlled) {
    textarea.__reactFiber$test = { memoizedProps: {
      value, setInputValue(next) { textarea.value = next; }
    } };
  }
  const document = {
    querySelectorAll(selector) { return selector.includes('textarea') ? [textarea] : []; },
    addEventListener() {}
  };
  const window = {
    postMessage(msg) { messages.push(msg); },
    addEventListener(type, fn) { if (type === 'message') listener = fn; }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../content/page-bridge.js'), 'utf8'), {
    window, document, Element: class {}, HTMLTextAreaElement: Textarea,
    HTMLInputElement: Textarea, Event: class {},
    requestAnimationFrame(fn) { fn(); }, setTimeout() {},
    getComputedStyle() { return { lineHeight: '20px' }; }
  });
  return { textarea, messages, async insert(appendSpace) {
    listener({ source: window, data: { channel: 'TCC_BRIDGE_V1', type: 'INSERT_EMOTE',
      requestId: 'test', token: 'Kappa', emoteId: '25', appendSpace } });
    for (let i = 0; i < 8; i++) await Promise.resolve();
  } };
}

for (const controlled of [false, true]) {
  test(`emote before text remains a separate token (controller=${controlled})`, async () => {
    const app = setup('hello', 0, 0, controlled);
    await app.insert(false);
    assert.equal(app.textarea.value, 'Kappa hello');
    assert.equal(app.messages.at(-1).ok, true);
    assert.equal(app.textarea.selectionStart, 6);
  });
  test(`selection replacement preserves token boundaries (controller=${controlled})`, async () => {
    const app = setup('aXYZb', 1, 4, controlled);
    await app.insert(false);
    assert.equal(app.textarea.value, 'a Kappa b');
  });
  test(`appendSpace=false omits optional trailing space at end (controller=${controlled})`, async () => {
    const app = setup('', 0, 0, controlled);
    await app.insert(false);
    assert.equal(app.textarea.value, 'Kappa');
  });
}
