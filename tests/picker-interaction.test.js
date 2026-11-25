const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const constants = require('../shared/constants.js');
function element() {
  const classes = new Set();
  return {style:{}, children:[], listeners:{}, dataset:{}, scrollTop:0,
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(){}},
    addEventListener(type, fn){this.listeners[type]=fn;},
    appendChild(el){this.children.push(el);el.parentNode=this;},
    removeChild(el){this.children.splice(this.children.indexOf(el),1);el.parentNode=null;},
    querySelectorAll(){return [];},getBoundingClientRect(){return {top:0,height:40,bottom:40};}
  };
}
function setup() {
  let now=0;
  const timers=new Map(); let timerId=0;
  function advance(t) { now=t; for(const [id,timer] of [...timers]) if(timer.at<=now){timers.delete(id);timer.fn();} }
  const frames=new Map(); let frameId=0;
  const listeners={}; const shadow=element(); const nav=element();
  const context={CSS:{escape:s=>s},performance:{now:()=>now},
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,at:now+ms});return timerId;},clearTimeout:id=>timers.delete(id),
    document:{createElement:element},window:{
      addEventListener:(type,fn)=>listeners[type]=fn,
      removeEventListener:type=>delete listeners[type]
    }};
  const source=fs.readFileSync(require.resolve('../content/emote-picker.js'),'utf8').replace('      init,',
    '      testSetup: (s,n) => { shadowRoot=s; navListEl=n; state.favorites=[{id:"1"},{id:"2"}]; }, testScroll:area=>{scrollAreaEl=area;}, testJump:jumpToSection, testSpy:handleScrollSpy, testActive:()=>activeNavId, testNav:attachNavDragHandler, testFav:attachFavoriteDragHandler,\n      init,');
  vm.runInNewContext(source,context);
  const picker=context.TCC.createEmotePickerManager({constants, storage:require('../shared/storage.js')});
  picker.testSetup(shadow,nav);
  return {picker,shadow,listeners,time:advance,frame(t){now=t;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(t));}};
}
for(const kind of ['Nav','Fav']) test(`${kind}: stationary long press starts drag and release cancels pending hold`,async()=>{
  const app=setup(),button=element();
  if(kind==='Nav') app.picker.testNav(button,{groupId:'a'},0,[{groupId:'a'},{groupId:'b'}],null);
  else app.picker.testFav(button,{id:'1'},0,element());
  button.listeners.pointerdown({button:0,clientX:0,clientY:0});
  app.time(449); assert.equal(button.classList.contains('dragging-source'),false);
  app.time(450); assert.equal(button.classList.contains('dragging-source'),true);
  await app.listeners.pointercancel({type:'pointercancel'});
  assert.equal(button.classList.contains('dragging-source'),false);
  button.listeners.pointerdown({button:0,clientX:0,clientY:0});
  await app.listeners.pointerup({type:'pointerup'});
  app.time(1000); assert.equal(button.classList.contains('dragging-source'),false);
});
for(const kind of ['Nav','Fav']) {
  for(const scenario of ['quick','held','moved-before-hold']) {
    test(`${kind}: ${scenario}`,async()=>{
      const app=setup(),button=element();
      if(kind==='Nav') app.picker.testNav(button,{groupId:'a'},0,[{groupId:'a'},{groupId:'b'}],null);
      else app.picker.testFav(button,{id:'1'},0,element());
      button.listeners.pointerdown({button:0,clientX:0,clientY:0});
      if(scenario==='moved-before-hold'){
        app.time(100); app.listeners.pointermove({clientX:15,clientY:15});
      }
      app.time(scenario==='quick'?100:500);
      app.listeners.pointermove({clientX:20,clientY:20});
      assert.equal(button.classList.contains('dragging-source'),scenario==='held');
      await app.listeners.pointercancel({type:'pointercancel'});
      assert.equal(button.classList.contains('dragging-source'),false);
      assert.equal(app.shadow.children.length,0);
    });
  }
}
test('feature switches preserve the other feature and legacy settings',()=>{
  const defaults=constants.DEFAULT_SETTINGS;
  const chatOff=constants.deepMergeSettings(defaults,{chatEnabled:false});
  assert.equal(chatOff.picker.enabled,true);
  const pickerOff=constants.deepMergeSettings(defaults,{picker:{enabled:false}});
  assert.equal(pickerOff.chatEnabled,true);
  assert.equal(constants.deepMergeSettings(defaults,{layout:{messageGap:8}}).picker.enabled,true);
  const app=setup();
  app.picker.updateState({settings:pickerOff});
  app.picker.open(); // Disabled picker must not even build its DOM.
  assert.equal(app.picker.isOpen(),false);
});

test('section jump scrolls within 80 ms without intermediate highlight changes',()=>{
  const app=setup();
  const area={scrollTop:0,scrollHeight:2000,clientHeight:400,querySelector:()=>({offsetTop:1004})};
  app.picker.testScroll(area);
  app.picker.testJump('channel:b');
  app.frame(40);
  assert.ok(area.scrollTop>0 && area.scrollTop<1000);
  app.picker.testSpy();
  assert.equal(app.picker.testActive(),'channel:b');
  app.frame(80);
  assert.equal(area.scrollTop,1000);
});

function setupFullPicker(extraDeps = {}) {
  const winListeners = new Map();
  const docListeners = new Map();
  const dispatchedEvents = [];
  const docClasses = new Set();
  const createdElements = [];
  const styleProps = {};

  function makeClassList(initialSet = new Set()) {
    return {
      add: (...xs) => xs.forEach(x => initialSet.add(x)),
      remove: (...xs) => xs.forEach(x => initialSet.delete(x)),
      toggle: (x, force) => {
        if (force === undefined) {
          if (initialSet.has(x)) { initialSet.delete(x); return false; }
          initialSet.add(x); return true;
        }
        if (force) initialSet.add(x); else initialSet.delete(x);
        return Boolean(force);
      },
      contains: x => initialSet.has(x)
    };
  }

  function makeEl(tag = 'div') {
    const classSet = new Set();
    let cls = '';
    const listeners = {};
    const el = {
      tagName: String(tag).toUpperCase(),
      id: '',
      children: [],
      dataset: {},
      attributes: {},
      listeners,
      isConnected: true,
      hidden: false,
      scrollTop: 0,
      style: {
        setProperty(k, v) { styleProps[k] = v; this[k] = v; }
      },
      get className() { return cls; },
      set className(val) {
        cls = String(val || '');
        classSet.clear();
        cls.split(/\s+/).filter(Boolean).forEach(c => classSet.add(c));
      },
      classList: makeClassList(classSet),
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        child.isConnected = true;
        return child;
      },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i !== -1) this.children.splice(i, 1);
        child.parentNode = null;
      },
      attachShadow() {
        el.shadowRoot = makeEl('shadow-root');
        return el.shadowRoot;
      },
      contains(node) {
        let cur = node;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentNode;
        }
        return false;
      },
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() {
        const w = parseFloat(this.style.width) || 0;
        const h = parseFloat(this.style.height) || 0;
        return { left: 0, top: 0, right: w, bottom: h, width: w, height: h };
      }
    };
    createdElements.push(el);
    return el;
  }

  const chatInput = makeEl('div');
  chatInput.className = 'chat-input';
  chatInput.getBoundingClientRect = () => ({ left: 930, top: 820, right: 1272, bottom: 892, width: 342, height: 72 });
  const anchorBtn = makeEl('button');
  anchorBtn.getBoundingClientRect = () => ({ left: 1210, top: 854, right: 1240, bottom: 884, width: 30, height: 30 });
  anchorBtn.closest = (sel) => sel && sel.includes('.chat-input') ? chatInput : null;
  const rewardsTriggerBtn = makeEl('button');
  rewardsTriggerBtn.closest = (sel) => {
    if (sel && sel.includes('ビッツとポイントの残高')) return rewardsTriggerBtn;
    if (sel && sel.includes('.chat-input')) return chatInput;
    return null;
  };
  chatInput.appendChild(anchorBtn);
  chatInput.appendChild(rewardsTriggerBtn);

  const body = makeEl('body');
  const documentElement = makeEl('html');
  const document = {
    documentElement,
    body,
    createElement: makeEl,
    addEventListener(type, fn) { (docListeners.get(type) || docListeners.set(type, []).get(type)).push(fn); },
    removeEventListener(type, fn) {
      const arr = docListeners.get(type);
      if (arr) { const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1); }
    },
    querySelector(sel) {
      if (sel && sel.includes('emote-picker-button')) return anchorBtn;
      if (sel && sel.includes('.chat-input')) return chatInput;
      return null;
    },
    querySelectorAll() { return []; }
  };

  const captureRegistrations = [];
  const window = {
    captureRegistrations,
    innerWidth: 1280,
    innerHeight: 900,
    addEventListener(type, fn, capture) {
      captureRegistrations.push({ type, capture });
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { winListeners.get(type)?.delete(fn); },
    dispatchEvent(ev) {
      dispatchedEvents.push(ev);
      for (const fn of [...(winListeners.get(ev.type) || [])]) fn(ev);
      return true;
    }
  };
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }

  let bodyRenderCount = 0;
  const storageStub = {
    ...require('../shared/storage.js'),
    findCurrentChannelGroupId: () => null,
    computeOrderedGroups: (groups) => {
      bodyRenderCount++;
      return Object.values(groups || {});
    }
  };

  const context = {
    CSS: { escape: s => s },
    CustomEvent,
    MutationObserver: class { observe() {} disconnect() {} },
    encodeURIComponent,
    getComputedStyle: () => ({ backgroundColor: 'rgb(24, 24, 27)' }),
    requestAnimationFrame: fn => 1,
    cancelAnimationFrame: () => {},
    Date,
    setTimeout,
    clearTimeout,
    document,
    window
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../content/emote-picker.js'), 'utf8'), context);

  const sizeCommits = [];
  const picker = context.TCC.createEmotePickerManager({
    constants,
    storage: storageStub,
    onSizeCommit: extraDeps.onSizeCommit || (sz => sizeCommits.push(sz))
  });
  picker.init({
    settings: extraDeps.settings || constants.DEFAULT_SETTINGS,
    catalog: {
      groups: {
        global: { groupId: 'global', type: 'global', displayName: 'グローバル', emotes: [{ id: '25', token: 'Kappa', assetType: 'STATIC' }] }
      },
      updatedAt: 1
    },
    favorites: [],
    groupOrder: [],
    collapsedGroups: []
  });

  return {
    picker,
    window,
    CustomEvent,
    docListeners,
    docClasses: documentElement.classList,
    dispatchedEvents,
    sizeCommits,
    body,
    chatInput,
    rewardsTriggerBtn,
    getBodyRenderCount: () => bodyRenderCount
  };
}

test('mutual close: opening Emote Picker notifies rewards and tcc:rewards-opened / clicking rewards trigger closes Emote Picker', () => {
  const app = setupFullPicker();
  app.picker.open();
  assert.equal(app.picker.isOpen(), true);
  assert.equal(app.dispatchedEvents.filter(e => e.type === 'tcc:emote-picker-opened').length, 1);

  // Closing from rewards opening notification
  app.window.dispatchEvent(new app.CustomEvent('tcc:rewards-opened'));
  assert.equal(app.picker.isOpen(), false);

  // Reopen, then simulate mousedown on Twitch's Channel Points button inside .chat-input
  app.picker.open();
  assert.equal(app.picker.isOpen(), true);
  const mousedowns = app.docListeners.get('mousedown') || [];
  mousedowns.forEach(fn => fn({
    target: app.rewardsTriggerBtn,
    composedPath: () => [app.rewardsTriggerBtn, app.chatInput, app.body]
  }));
  assert.equal(app.picker.isOpen(), false);
});

test('dragging Emote Picker nw resize handle updates panel size live without re-rendering body and commits on pointerup', () => {
  const app = setupFullPicker();
  app.picker.open();
  const rendersAfterOpen = app.getBodyRenderCount();
  const host = app.body.children.find(el => el.id === 'tcc-emote-picker-host');
  const panel = host.shadowRoot.children.find(el => el.classList.contains('tcc-panel'));
  const nwHandle = panel.children.find(el => el.dataset && el.dataset.resizeMode === 'nw');
  assert.ok(nwHandle);
  assert.equal(nwHandle.hidden, false);

  nwHandle.listeners.pointerdown[0]({
    button: 0,
    clientX: 600,
    clientY: 240,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(panel.classList.contains('is-resizing'), true);
  assert.equal(app.docClasses.contains('tcc-picker-resizing-nwse'), true);

  app.window.dispatchEvent({ type: 'pointermove', clientX: 520, clientY: 180 });
  assert.equal(panel.style.width, '760px');
  assert.equal(panel.style.height, '660px');
  assert.equal(app.getBodyRenderCount(), rendersAfterOpen);

  app.window.dispatchEvent({ type: 'pointerup' });
  assert.equal(panel.classList.contains('is-resizing'), false);
  assert.equal(app.docClasses.contains('tcc-picker-resizing-nwse'), false);
  assert.equal(app.sizeCommits.length, 1);
  assert.equal(app.sizeCommits[0].pickerWidthPx, 760);
  assert.equal(app.sizeCommits[0].pickerHeightPx, 660);
});

test('Emote Picker percentage width mode resolves vw width and commits pickerWidthPct on drag release', () => {
  const pctSettings = constants.deepMergeSettings(constants.DEFAULT_SETTINGS, {
    picker: { pickerWidthUnit: '%', pickerWidthPct: 50, pickerHeightPx: 600 }
  });
  const app = setupFullPicker({ settings: pctSettings });
  app.picker.open();
  const host = app.body.children.find(el => el.id === 'tcc-emote-picker-host');
  const panel = host.shadowRoot.children.find(el => el.classList.contains('tcc-panel'));
  assert.equal(panel.style.width, '640px');
  const nwHandle = panel.children.find(el => el.dataset && el.dataset.resizeMode === 'nw');
  nwHandle.listeners.pointerdown[0]({
    button: 0,
    clientX: 600,
    clientY: 240,
    preventDefault() {},
    stopPropagation() {}
  });
  app.window.dispatchEvent({ type: 'pointermove', clientX: 472, clientY: 200 });
  assert.equal(panel.style.width, '768px');
  assert.equal(panel.style.height, '640px');
  app.window.dispatchEvent({ type: 'pointerup' });
  assert.equal(app.sizeCommits.length, 1);
  assert.equal(app.sizeCommits[0].pickerWidthPct, 60);
  assert.equal(app.sizeCommits[0].pickerHeightPx, 640);
});


test('resize captures events before page handlers, preserves live size across updates, and cancels cleanly', () => {
  const app = setupFullPicker();
  app.picker.open();
  const host = app.body.children.find(el => el.id === 'tcc-emote-picker-host');
  const panel = host.shadowRoot.children.find(el => el.classList.contains('tcc-panel'));
  const handle = panel.children.find(el => el.dataset?.resizeMode === 'nw');
  const captured = [];
  handle.setPointerCapture = id => captured.push(['set', id]);
  handle.releasePointerCapture = id => captured.push(['release', id]);
  handle.listeners.pointerdown[0]({ button: 0, pointerId: 5, clientX: 600, clientY: 240,
    preventDefault() {}, stopPropagation() {} });
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    assert.equal(app.window.captureRegistrations.filter(e => e.type === type).at(-1).capture, true);
  }
  app.window.dispatchEvent({ type: 'pointermove', pointerId: 99, clientX: 520, clientY: 180 });
  assert.equal(panel.style.width, '680px');
  app.window.dispatchEvent({ type: 'pointermove', pointerId: 5, clientX: 520, clientY: 180 });
  assert.equal(panel.style.width, '760px');
  app.picker.updateState({ settings: constants.DEFAULT_SETTINGS }, { layoutOnly: true });
  assert.equal(panel.style.width, '760px');
  app.window.dispatchEvent({ type: 'pointerup', pointerId: 99 });
  assert.equal(panel.classList.contains('is-resizing'), true);
  app.window.dispatchEvent({ type: 'pointercancel', pointerId: 5 });
  assert.equal(panel.style.width, '680px');
  assert.equal(panel.style.height, '600px');
  assert.equal(panel.classList.contains('is-resizing'), false);
  assert.equal(app.sizeCommits.length, 0);
  assert.deepEqual(captured, [['set', 5], ['release', 5]]);
});


test('percentage resize shrinks below 745px on a 3840px display and saves the new width', () => {
  const settings = constants.deepMergeSettings(constants.DEFAULT_SETTINGS, {
    picker: {pickerWidthUnit:'%',pickerWidthPct:20,pickerHeightPx:600}
  });
  const app = setupFullPicker({settings});
  app.window.innerWidth = 3840;
  app.picker.open();
  const host = app.body.children.find(el => el.id === 'tcc-emote-picker-host');
  const panel = host.shadowRoot.children.find(el => el.classList.contains('tcc-panel'));
  assert.equal(panel.style.width,'768px');
  const handle = panel.children.find(el => el.dataset?.resizeMode === 'w');
  handle.listeners.pointerdown[0]({button:0,clientX:600,clientY:240,preventDefault(){},stopPropagation(){}});
  app.window.dispatchEvent({type:'pointermove',clientX:984,clientY:240});
  assert.equal(panel.style.width,'384px');
  app.window.dispatchEvent({type:'pointerup'});
  assert.equal(app.sizeCommits[0].pickerWidthPct,10);
});


test('resize badge reports actual pixel dimensions at the percentage minimum', () => {
  const settings = constants.deepMergeSettings(constants.DEFAULT_SETTINGS, {
    picker: {pickerWidthUnit:'%',pickerWidthPct:20,pickerHeightPx:600}
  });
  const app = setupFullPicker({settings});
  app.window.innerWidth = 3840;
  app.picker.open();
  const host = app.body.children.find(el => el.id === 'tcc-emote-picker-host');
  const panel = host.shadowRoot.children.find(el => el.classList.contains('tcc-panel'));
  const badge = panel.children.find(el => el.classList.contains('tcc-resize-badge'));
  const handle = panel.children.find(el => el.dataset?.resizeMode === 'w');
  handle.listeners.pointerdown[0]({button:0,clientX:600,clientY:240,preventDefault(){},stopPropagation(){}});
  assert.equal(badge.textContent,'幅 768px × 高さ 600px');
  app.window.dispatchEvent({type:'pointermove',clientX:984,clientY:240});
  assert.equal(badge.textContent,'幅 384px × 高さ 600px');
  app.window.dispatchEvent({type:'pointermove',clientX:1600,clientY:240});
  assert.equal(panel.style.width,'280px');
  assert.equal(badge.textContent,'幅 280px × 高さ 600px');
  app.window.dispatchEvent({type:'pointerup'});
});

test('resize badge uses visible height when requested height exceeds available space', () => {
  const settings = constants.deepMergeSettings(constants.DEFAULT_SETTINGS, {
    picker: {pickerWidthUnit:'px',pickerWidthPx:680,pickerHeightPx:850}
  });
  const app = setupFullPicker({settings});
  app.picker.open();
  const host = app.body.children.find(el => el.id === 'tcc-emote-picker-host');
  const panel = host.shadowRoot.children.find(el => el.classList.contains('tcc-panel'));
  const badge = panel.children.find(el => el.classList.contains('tcc-resize-badge'));
  const handle = panel.children.find(el => el.dataset?.resizeMode === 'n');
  handle.listeners.pointerdown[0]({button:0,clientX:600,clientY:240,preventDefault(){},stopPropagation(){}});
  assert.equal(panel.style.height,'804px');
  assert.equal(badge.textContent,'幅 680px × 高さ 804px');
  app.window.dispatchEvent({type:'pointermove',clientX:600,clientY:100});
  assert.equal(badge.textContent,'幅 680px × 高さ 804px');
  app.window.dispatchEvent({type:'pointerup'});
});


test('percentage emote picker follows successive single-pixel moves and persists them', () => {
  const settings=constants.deepMergeSettings(constants.DEFAULT_SETTINGS,{picker:{pickerWidthUnit:'%',pickerWidthPct:50}});
  const app=setupFullPicker({settings});
  app.picker.open();
  const host=app.body.children.find(el=>el.id==='tcc-emote-picker-host');
  const panel=host.shadowRoot.children.find(el=>el.classList.contains('tcc-panel'));
  const handle=panel.children.find(el=>el.dataset?.resizeMode==='w');
  handle.listeners.pointerdown[0]({button:0,clientX:600,clientY:240,preventDefault(){},stopPropagation(){}});
  for(let delta=1;delta<=5;delta++) {
    app.window.dispatchEvent({type:'pointermove',clientX:600-delta,clientY:240});
    assert.equal(panel.style.width,`${640+delta}px`);
  }
  app.window.dispatchEvent({type:'pointerup'});
  assert.equal(constants.resolvePickerWidthPx({...settings.picker,...app.sizeCommits[0]},1280),645);
});
