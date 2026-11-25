const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const constants = require('../shared/constants.js');

function setup() {
  const source = fs.readFileSync(require.resolve('../content/chat-width.js'), 'utf8')
    .replace('      init,', '      isRightColumnCollapsed,\n      init,');
  const context = { document: { querySelector() { return null; } } };
  vm.runInNewContext(source, context);
  const manager = context.TCC.createChatWidthManager(constants);
  const col = { classList: new Set() };
  const chat = {
    classList: new Set(['channel-root__right-column--expanded']),
    style: { transform: 'translateX(-340px) translateZ(0px)' },
    closest() { return null; },
    getBoundingClientRect() { return { height: 900 }; }
  };
  col.classList.contains = col.classList.has.bind(col.classList);
  chat.classList.contains = chat.classList.has.bind(chat.classList);
  return { manager, col, chat };
}

test('notifications aria-hide the background without collapsing an expanded chat', () => {
  const { manager, col, chat } = setup();
  assert.equal(manager.isRightColumnCollapsed(col, chat, false), false);
  chat.closest = selector => selector === '[aria-hidden="true"]' ? { className: 'app-root' } : null;
  assert.equal(manager.isRightColumnCollapsed(col, chat, false), false);
  chat.closest = () => null;
  assert.equal(manager.isRightColumnCollapsed(col, chat, false), false);
});

test('native collapse classes, transforms and hidden geometry still disable chat width', () => {
  const { manager, col, chat } = setup();
  col.classList.add('right-column--collapsed');
  assert.equal(manager.isRightColumnCollapsed(col, chat, false), true);
  col.classList.clear();
  chat.classList.clear();
  assert.equal(manager.isRightColumnCollapsed(col, chat, false), true);
  chat.classList.add('channel-root__right-column--expanded');
  chat.style.transform = 'translateX(0px)';
  assert.equal(manager.isRightColumnCollapsed(col, chat, false), true);
  chat.style.transform = 'translateX(-340px)';
  chat.getBoundingClientRect = () => ({ height: 0 });
  assert.equal(manager.isRightColumnCollapsed(col, chat, false), true);
});
