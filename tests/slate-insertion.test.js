const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Slate emote conversion never applies serialized token offsets to inline text leaves', async () => {
  const messages = [];
  let text = '';
  let images = 0;
  let cursorCalls = 0;
  const input = { focus() {}, querySelectorAll: () => Array(images).fill({}), get textContent() { return text; } };
  const controller = {
    getControlledValue: () => text,
    setInputValue(next) { text = next; images++; },
    stateNode: { setCursorSelection() { cursorCalls++; throw Error('Invalid Slate text offset'); } }
  };
  let source = fs.readFileSync(require.resolve('../content/page-bridge.js'), 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, `
    findVisibleChatInput = () => ({kind: 'slate', el: testInput});
    findSlateEditorFromDom = () => null;
    findTwitchChatInputController = () => testController;
    findTwitchEmoteHandlers = () => [{fn: () => { testController.setInputValue('Kappa '); }, thisArg: null}];
    window.testInsert = handleInsertEmote;
  })();`);
  const window = { postMessage: msg => messages.push(msg), addEventListener() {} };
  vm.runInNewContext(source, { window, document: {activeElement:input, addEventListener() {}},
    testInput:input, testController:controller, requestAnimationFrame: fn => fn(), setTimeout() {} });
  await window.testInsert({requestId:'first', token:'Kappa', emoteId:'25'});
  await window.testInsert({requestId:'second', token:'Kappa', emoteId:'25'});
  assert.equal(cursorCalls, 0);
  assert.equal(images, 2);
  assert.equal(messages.at(-1).ok, true);
  assert.equal(messages.at(-1).convertedToEmote, true);
});


test('Slate fallback inserts token and spacing together before normalization', async () => {
  const calls = [];
  const messages = [];
  const editor = {
    children: [{children:[{text:'hello'}]}],
    selection: {anchor:{path:[0,0],offset:5},focus:{path:[0,0],offset:5}},
    insertText(text) { calls.push(text); this.children[0].children[0].text += text; }
  };
  const input = { focus() {}, querySelectorAll: () => [], textContent:'hello' };
  let source = fs.readFileSync(require.resolve('../content/page-bridge.js'), 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, `
    findVisibleChatInput = () => ({kind: 'slate', el: testInput});
    findSlateEditorFromDom = () => testEditor;
    findTwitchEmoteHandlers = () => [];
    window.testInsert = handleInsertEmote;
  })();`);
  const window = {postMessage: msg => messages.push(msg), addEventListener() {}};
  vm.runInNewContext(source, {window, document:{activeElement:input, addEventListener(){}},
    testInput:input, testEditor:editor, requestAnimationFrame:fn=>fn(), setTimeout(){}});
  await window.testInsert({token:'Kappa',emoteId:'25',requestId:'fallback'});
  assert.deepEqual(calls, [' Kappa ']);
  assert.equal(messages.at(-1).method, 'slate_insert_text');
});
