const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the real controller against a native list -> detail -> network-result fixture.
function setup(nativeDisabled = false, inputRequired = false, noConfirm = false, storedSettings = {}, options = {}) {
  const frames = [];
  const timers = new Map();
  let timerId = 0;
  let now = 0;
  let message;
  let phase = 'list';
  let confirmClicks = 0;
  let closeClicks = 0;
  let footerClicks = 0;
  let bitsTabClicks = 0;
  let filterClickCount = 0;
  let triggerClicks = 0;
  let activeFilter = options.initialFilter || null;
  phase = options.initialPhase || 'list';
  let queuedFilterSwitch = false;
  let snapshotDuringPowerups = false;
  const docListeners = {};
  const winListeners = {};
  const dispatchedEvents = [];
  const storageSets = [];
  const classes = () => {
    const set = new Set();
    return {
      add: (...xs) => xs.forEach(x => set.add(x)),
      remove: (...xs) => xs.forEach(x => set.delete(x)),
      toggle: (x, force) => {
        if (force === undefined) {
          if (set.has(x)) { set.delete(x); return false; }
          set.add(x); return true;
        }
        if (force) set.add(x); else set.delete(x);
        return Boolean(force);
      },
      contains: x => set.has(x)
    };
  };
  const create = () => ({ dataset: {}, className: '', hidden: false, style: {}, classList: classes(), children: [], listeners: {},
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, querySelector() { return null; },
    appendChild(el) { this.children.push(el); }, replaceChildren() { this.children = []; },
    addEventListener(type, fn) { this[type] = fn; (this.listeners[type] ||= []).push(fn); }, remove() { this.removed = true; } });
  let nativeScroll = { scrollTop: options.initialScrollTop || 0, scrollLeft: 0 };
  let snapshotScroll;
  const title = { textContent: 'Reward' };
  const cost = { textContent: '10', querySelector() { return null; } };
  const nativeButton = { disabled: false, getAttribute() { return null; },
    querySelector(selector) { return selector === '.reward-icon__cost' ? cost : selector === '.tcc-reward-name' ? this.name : null; },
    appendChild(el) { this.name = el; }, click() { if (options.composerOnInspect) { throw new Error('Background check opened the chat composer'); } phase = 'detail'; } };
  let redeem;
  const item = { dataset: { tccRewardState: JSON.stringify({ reward: { id: 'reward', title: 'Reward', cost: 10, isUserInputRequired: inputRequired } }) },
    querySelector(selector) {
      if (selector === 'p[title]') return title;
      if (selector === 'button:not(.tcc-redeem)') return nativeButton;
      if (selector === '.tcc-redeem') return redeem;
      return null;
    }, appendChild(el) { redeem = el; } };
  if (options.rewardState !== undefined) item.dataset.tccRewardState = options.rewardState;
  const confirm = { get disabled() { return typeof nativeDisabled === 'function' ? nativeDisabled(now) : nativeDisabled; }, getAttribute() { return null; }, click() { confirmClicks++; } };
  const close = { click() { closeClicks++; phase = 'closed'; } };
  const nativeFooterBtn = options.footerButton
    ? { dataset: {}, title: '', disabled: false, click() { footerClicks++; } }
    : null;
  let snapFooterBtn = null;
  let snapBitsRadio = null;
  const rewardsLabel = { textContent: 'Rewards', dataset: {} };
  const allFilterEl = activeFilter
    ? { getAttribute(name) { return name === 'aria-checked' ? String(activeFilter === 'all') : null; } }
    : null;
  const rewardsFilterEl = activeFilter
    ? {
        getAttribute(name) {
          if (name === 'aria-checked') return String(activeFilter === 'rewards');
          if (name === 'data-a-target') return 'reward-filter-rewards';
          return null;
        },
        querySelector(sel) { return sel === 'strong' ? rewardsLabel : null; },
        click() { filterClickCount++; queuedFilterSwitch = true; }
      }
    : null;
  const bitsFilterEl = options.withBitsTab || activeFilter
    ? {
        getAttribute(name) {
          if (name === 'aria-checked') return String(activeFilter === 'bits');
          if (name === 'data-a-target') return 'reward-filter-bits';
          return null;
        },
        click() { bitsTabClicks++; activeFilter = 'bits'; }
      }
    : null;
  const triggerChatInput = options.chatInputRect
    ? { getBoundingClientRect() { return options.chatInputRect; }, querySelector() { return null; } }
    : null;
  const triggerBtn = options.withDialogTrigger
    ? {
        tagName: 'BUTTON',
        isConnected: true,
        matches(sel) { return sel.includes('ビッツとポイントの残高'); },
        closest(sel) {
          if (triggerChatInput && sel && sel.includes('.chat-input')) return triggerChatInput;
          return null;
        },
        querySelector() { return null; },
        getClientRects() { return [{}]; },
        getBoundingClientRect() { return options.triggerRect || { left: 820, top: 1220, width: 140, height: 36, bottom: 1256 }; },
        click() {
          triggerClicks++;
          if (options.openOnTriggerClick && phase === 'closed') phase = 'list';
        }
      }
    : null;
  const dialogEl = options.withDialogTrigger
    ? {
        classList: classes(),
        style: {},
        dataset: {},
        children: [],
        clientLeft: 0,
        clientTop: 0,
        appendChild(el) {
          this.children.push(el);
          el.remove = () => {
            el.removed = true;
            const idx = this.children.indexOf(el);
            if (idx !== -1) this.children.splice(idx, 1);
          };
        },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
        querySelectorAll(sel) {
          const parts = sel.split(',').map(p => p.trim().replace(/^\./, ''));
          return this.children.filter(el => parts.some(cls => (el.className || '').split(/\s+/).includes(cls) || el.classList?.contains(cls)));
        },
        getBoundingClientRect() {
          if (this.classList.contains('tcc-rewards-anchored')) {
            const left = parseFloat(this.style['--tcc-rewards-left']) + (options.fixedOriginX || 0);
            const top = parseFloat(this.style['--tcc-rewards-top']) + (options.fixedOriginY || 0);
            const width = parseFloat(this.style['--tcc-rewards-box-width']);
            const height = parseFloat(this.style['--tcc-rewards-box-height']);
            return {left,top,width,height,right:left+width,bottom:top+height};
          }
          const parts = String(this.style.translate || '').trim().split(/\s+/);
          const shiftX = parseFloat(parts[0]) || 0;
          const shiftY = parseFloat(parts[1]) || 0;
          const left = (options.dialogLeft ?? 600) + shiftX;
          const h = activeFilter === 'all' ? 760 : options.compactHeight || 600;
          const bottom = (activeFilter === 'all' ? 1350 : 1250) + shiftY;
          const w = options.dialogWidth || 400;
          return { left, top: bottom - h, width: w, right: left + w, height: h, bottom };
        }
      }
    : null;
  let snapshot;
  const panelFooter = options.footerButton
    ? { querySelector() { return null; }, querySelectorAll(sel) { return sel === 'button' ? [nativeFooterBtn] : []; } }
    : { querySelector() { return null; }, querySelectorAll() { return []; } };
  const panel = { classList: classes(), dataset: {}, style: {}, lastElementChild: panelFooter,
    getClientRects() { return [{}]; },
    getBoundingClientRect() {
      if (dialogEl) return dialogEl.getBoundingClientRect();
      return { left: 0, top: 0, width: 400, height: 600, bottom: 600 };
    },
    closest(sel) {
      if (dialogEl && sel === '[role="dialog"]') return dialogEl;
      return null;
    },
    cloneNode() {
      if (activeFilter === 'all') snapshotDuringPowerups = true;
      snapFooterBtn = options.footerButton
        ? {
            disabled: false,
            matches() { return false; },
            closest(sel) { return sel === 'button' ? snapFooterBtn : null; }
          }
        : null;
      snapBitsRadio = options.withBitsTab
        ? {
            disabled: true,
            getAttribute(name) { return name === 'data-a-target' ? 'reward-filter-bits' : null; },
            closest(sel) { return sel === '[role="radio"]' ? snapBitsRadio : null; }
          }
        : null;
      const snapshotFooter = options.footerButton
        ? {
            querySelector() { return null; },
            querySelectorAll(sel) { return sel === 'button' ? [snapFooterBtn] : []; },
            contains(el) { return el === snapFooterBtn; }
          }
        : undefined;
      snapshotScroll = { scrollTop: 0, scrollLeft: 0 };
      snapshot = {
        ...create(),
        lastElementChild: snapshotFooter,
        querySelector() { return null; },
        querySelectorAll(selector) {
          if (selector === '.scrollable-area') return [snapshotScroll];
          if (selector === '.tcc-redeem') return [create()];
          if (selector === '[class*="rewardListItem--"]') return [item];
          if (selector.includes('[role="radio"]')) return snapBitsRadio ? [snapBitsRadio] : [];
          if (selector === 'button') return snapFooterBtn ? [snapFooterBtn] : [];
          return [];
        }
      };
      return snapshot;
    },
    querySelector(selector) {
      if (selector === '#channel-points-reward-center-header') return { textContent: phase === 'detail' ? 'Reward' : 'Rewards' };
      if (selector === '.rewards-list') return phase === 'list' ? {} : null;
      if (selector.includes('reward-filter-all')) return phase === 'list' ? allFilterEl : null;
      if (selector.includes('reward-filter-rewards')) return phase === 'list' ? rewardsFilterEl : null;
      if (selector.includes('rewardListItem--')) return phase === 'list' && activeFilter !== 'bits' ? item : null;
      if (selector.includes('bitsRewardListItem--')) return phase === 'list' && (activeFilter === 'all' || activeFilter === 'bits') ? {} : null;
      if (selector.includes('aria-label="戻る"')) return { click() { phase = 'list'; nativeScroll = { scrollTop: 0, scrollLeft: 0 }; } };
      if (selector.split(',').map(s=>s.trim()).includes(`[data-test-selector="${options.confirmMarker || 'RewardText'}"]`)) return phase === 'detail' && !noConfirm ? { closest() { return confirm; } } : null;
      if (selector.includes('aria-label="閉じる"')) return close;
      return null;
    }, querySelectorAll(selector) {
      if (selector === '.scrollable-area') return [nativeScroll];
      if (selector === '[class*="rewardListItem--"]') return phase === 'list' && activeFilter !== 'bits' ? [item] : [];
      if (selector === '[role="radio"]') return [rewardsFilterEl, bitsFilterEl].filter(Boolean);
      if (selector === '.tcc-redeem') return redeem ? [redeem] : [];
      return [];
    } };
  const docStyle = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
  const document = { documentElement: { classList: classes(), style: docStyle, setAttribute() {}, clientWidth: 1024 }, body: { appendChild() {} },
    createElement: create,
    addEventListener(type, fn) { docListeners[type] = fn; },
    querySelector() { return phase !== 'closed' ? panel : null; },
    querySelectorAll(selector) {
      if (triggerBtn && selector && selector.includes('ビッツとポイントの残高')) return [triggerBtn];
      return phase !== 'closed' ? [panel] : [];
    } };
  const window = {
    addEventListener(type, fn) {
      if (type === 'message') message = fn;
      if (!winListeners[type]) winListeners[type] = new Set();
      winListeners[type].add(fn);
    },
    removeEventListener(type, fn) {
      winListeners[type]?.delete(fn);
    },
    dispatchEvent(ev) {
      dispatchedEvents.push(ev);
      for (const fn of [...(winListeners[ev.type] || [])]) fn(ev);
      return true;
    }
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  let moCallback = null;
  vm.runInNewContext(fs.readFileSync(require.resolve('../content/rewards.js'), 'utf8'), {
    window, document, CustomEvent, location: { pathname: '/darumarum' }, Date: { now: () => now },
    chrome: { storage: { local: { get(key, fn) { fn({ tcc_settings: storedSettings }); }, set(data, fn) { storageSets.push(data); fn?.(); } }, onChanged: { addListener() {} } } },
    MutationObserver: class { constructor(fn) { moCallback = fn; } observe() {} }, requestAnimationFrame(fn) { frames.push(fn); },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); }
  });
  function flush(maxSteps = 30) {
    for (let i = 0; frames.length && i < maxSteps; i++) {
      if (queuedFilterSwitch) {
        queuedFilterSwitch = false;
        activeFilter = 'rewards';
      }
      now += 20;
      frames.shift()();
    }
  }
  if (!options.deferFlush) flush();
  return { panel, dialogEl, triggerBtn, nativeFooterBtn, get snapFooterBtn() { return snapFooterBtn; }, get snapBitsRadio() { return snapBitsRadio; }, docListeners, docStyle,
    window, dispatchedEvents, winListeners, storageSets, CustomEvent,
    get nativeScroll() { return nativeScroll; }, get snapshotScroll() { return snapshotScroll; },
    get triggerClicks() { return triggerClicks; },
    setPhase(next) { phase = next; },
    triggerMutation() { moCallback?.(); },
    get phase() { return phase; }, get activeFilter() { return activeFilter; }, get snapshot() { return snapshot; }, get redeem() { return redeem; }, timers,
    get confirmClicks() { return confirmClicks; }, get closeClicks() { return closeClicks; },
    get footerClicks() { return footerClicks; }, get bitsTabClicks() { return bitsTabClicks; }, get filterClickCount() { return filterClickCount; },
    get snapshotDuringPowerups() { return snapshotDuringPowerups; },
    flush,
    start() { redeem.click({ stopPropagation() {} }); flush(); },
    result(status, rewardId = 'reward') { message({ source: window, data: { channel: 'TCC_REWARDS_V1', status, rewardId, requestId: 1 } }); flush(); } };
}
test('native disabled flag controls the list without initiating redemption during checks', () => {
  const locked = setup(true);
  assert.equal(locked.redeem.disabled, true);
  assert.equal(locked.confirmClicks, 0);
  const available = setup(false);
  assert.equal(available.redeem.disabled, false);
  assert.equal(available.confirmClicks, 0);
});
test('input rewards never open the composer during background checks', () => {
  const app = setup(false, true);
  assert.equal(app.redeem.disabled, false);
  assert.equal(app.confirmClicks, 0);
  assert.equal(app.closeClicks, 0);
  assert.equal(app.snapshot.removed, true);
});
test('a native choice view without an exchange button is not mistaken for an unavailable reward', () => {
  const app = setup(false, false, true);
  assert.equal(app.redeem.disabled, false);
  assert.equal(app.confirmClicks, 0);
  assert.equal(app.closeClicks, 0);
});
test('a temporary native loading flag does not leave an available reward gray', () => {
  const app = setup(time => time < 100);
  assert.equal(app.redeem.disabled, false);
  assert.equal(app.confirmClicks, 0);
});
test('spinner/list remain until the matching redemption succeeds; confirm is dispatched once', () => {
  const app = setup(); app.start();
  assert.equal(app.confirmClicks, 1);
  assert.equal(app.closeClicks, 0);
  assert.equal(app.snapshot.removed, undefined);
  app.result('start'); app.result('success', 'other-reward');
  assert.equal(app.closeClicks, 0);
  app.result('success');
  assert.equal(app.confirmClicks, 1);
  assert.equal(app.closeClicks, 1);
  assert.equal(app.snapshot.removed, true);
  assert.equal(app.timers.size, 0);
});
test('errors and timeouts reveal native status without closing or redeeming again', () => {
  const app = setup(); app.start(); app.result('start'); app.result('error');
  assert.equal(app.closeClicks, 0); assert.equal(app.snapshot.removed, true);
  assert.equal(app.confirmClicks, 1);
  const delayed = setup(); delayed.start();
  for (const fn of delayed.timers.values()) fn();
  assert.equal(delayed.closeClicks, 0); assert.equal(delayed.snapshot.removed, true);
});
test('disabling rewards leaves the native panel untouched', () => {
  const app = setup(false, false, false, { rewards: { enabled: false } });
  assert.equal(app.panel.classList.contains('tcc-rewards-enabled'), false);
  assert.equal(app.panel.classList.contains('tcc-rewards-list'), false);
  assert.equal(app.redeem, undefined);
  assert.equal(app.snapshot, undefined);
  assert.equal(app.confirmClicks, 0);
});
test('disabling precheckAvailability avoids background checks while keeping 1-click UI', () => {
  const app = setup(true, false, false, { rewards: { precheckAvailability: false } });
  assert.equal(app.panel.classList.contains('tcc-rewards-list'), true);
  assert.ok(app.redeem);
  assert.equal(app.redeem.disabled, false);
  assert.equal(app.snapshot, undefined);
  assert.equal(app.phase, 'list');
  assert.equal(app.confirmClicks, 0);
});
test('disabling oneClickRedeem opens the detail view without submitting', () => {
  const app = setup(false, false, false, { rewards: { oneClickRedeem: false } });
  assert.equal(app.panel.classList.contains('tcc-rewards-passive-cost'), true);
  assert.equal(app.snapshot, undefined);
  app.start();
  assert.equal(app.phase, 'detail');
  assert.equal(app.confirmClicks, 0);
  assert.equal(app.snapshot, undefined);
});
test('disabling autoCloseOnRedeem returns to the compact list after successful 1-click redeem', () => {
  const app = setup(false, false, false, { rewards: { autoCloseOnRedeem: false } });
  app.start();
  assert.equal(app.confirmClicks, 1);
  app.result('start');
  app.result('success');
  assert.equal(app.closeClicks, 0);
  assert.equal(app.phase, 'list');
  assert.equal(app.snapshot.removed, true);
});
test('opening on the All tab switches to Rewards before creating any precheck snapshot', () => {
  const app = setup(false, false, false, {}, { initialFilter: 'all' });
  assert.equal(app.filterClickCount, 1);
  assert.equal(app.snapshotDuringPowerups, false);
  assert.ok(app.redeem);
  assert.equal(app.snapshot.removed, true);
});
test('legacy hideAllTab/disableAnimation/compactList=false settings still keep always-on rewards UI', () => {
  const app = setup(false, false, false, { rewards: { hideAllTab: false, disableAnimation: false, compactList: false } }, { initialFilter: 'all' });
  assert.equal(app.filterClickCount, 1);
  assert.equal(app.panel.classList.contains('tcc-rewards-list'), true);
  assert.equal(app.panel.classList.contains('tcc-rewards-hide-all'), true);
  assert.ok(app.redeem);
});
test('footer buttons retain native behavior and stay clickable during background checks', () => {
  const app = setup(true, false, false, {}, { footerButton: true, deferFlush: true });
  app.flush(2);
  assert.equal(app.nativeFooterBtn.title, '');
  assert.equal(app.nativeFooterBtn.dataset.tccCloseToggle, undefined);
  assert.equal(app.snapFooterBtn.disabled, false);
  app.snapshot.click({ target: app.snapFooterBtn });
  app.flush();
  assert.equal(app.footerClicks, 1);
  assert.equal(app.closeClicks, 0);
});
test('popover shifts above the bottom trigger button and clicking the trigger closes it', () => {
  const app = setup(false, false, false, {}, { withDialogTrigger: true });
  assert.equal(app.dialogEl.getBoundingClientRect().bottom, 1212);
  assert.ok(app.dialogEl.getBoundingClientRect().bottom <= app.triggerBtn.getBoundingClientRect().top - 8);
  let prevented = false;
  let stopped = false;
  app.docListeners.pointerdown({ target: { closest: () => app.triggerBtn } });
  app.docListeners.click({
    target: { closest: () => app.triggerBtn },
    detail: 1,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; }
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(app.closeClicks, 1);
});
test('panel height stays locked during precheck and positionPopover waits for All -> Rewards switch', () => {
  const app = setup(true, false, false, {rewards:{heightPx:400}}, {
    withDialogTrigger: true,
    initialFilter: 'all',
    compactHeight: 400,
    deferFlush: true
  });
  // Frame 1 sees the All tab: switches to Rewards and skips positioning/snapshot until switched.
  app.flush(1);
  assert.equal(app.filterClickCount, 1);
  assert.equal(app.dialogEl.style.translate, undefined);
  assert.equal(app.snapshot, undefined);
  // Frame 2 + 3: Rewards tab active -> positions against 400px list height, starts checking, locks panel height & CSS var.
  app.flush(2);
  assert.equal(app.dialogEl.getBoundingClientRect().bottom, 1212);
  assert.equal(app.panel.style.height, '400px');
  assert.equal(app.panel.style.overflow, 'hidden');
  assert.equal(app.docStyle['--tcc-snapshot-h'], '400px');
  // Finishing precheck unlocks panel height & clears CSS var cleanly.
  app.flush();
  assert.equal(app.panel.style.height, undefined);
  assert.equal(app.panel.style.overflow, undefined);
  assert.equal(app.docStyle['--tcc-snapshot-h'], undefined);
  assert.equal(app.dialogEl.getBoundingClientRect().bottom, 1212);
});
test('standalone Power-ups tab stays open without switching back to Rewards', () => {
  const app = setup(false, false, false, {}, { initialFilter: 'bits' });
  assert.equal(app.filterClickCount, 0);
  assert.equal(app.activeFilter, 'bits');
  assert.equal(app.redeem, undefined);
});
test('clicking a non-button Power-ups radio tab during background checks switches cleanly to Power-ups', () => {
  const app = setup(true, false, false, {}, { withBitsTab: true, deferFlush: true });
  app.flush(2);
  assert.equal(app.snapBitsRadio.disabled, false);
  app.snapshot.click({ target: app.snapBitsRadio });
  app.flush();
  assert.equal(app.bitsTabClicks, 1);
  assert.equal(app.activeFilter, 'bits');
  assert.equal(app.closeClicks, 0);
});

test('dispatching tcc:emote-picker-opened closes an open rewards panel even during precheck', () => {
  const app = setup(true, false, false, {}, { withDialogTrigger: true, deferFlush: true });
  app.flush(2);
  assert.ok(app.snapshot);
  assert.equal(app.closeClicks, 0);
  app.window.dispatchEvent(new app.CustomEvent('tcc:emote-picker-opened'));
  assert.equal(app.closeClicks, 1);
  assert.equal(app.phase, 'closed');
  assert.equal(app.snapshot.removed, true);
});

test('opening a visible rewards panel dispatches tcc:rewards-opened once per open session', () => {
  const app = setup(false, false, false, {}, { withDialogTrigger: true, initialPhase: 'closed' });
  assert.equal(app.dispatchedEvents.filter(e => e.type === 'tcc:rewards-opened').length, 0);
  app.setPhase('list');
  app.triggerMutation();
  app.flush();
  app.triggerMutation();
  app.flush();
  assert.equal(app.dispatchedEvents.filter(e => e.type === 'tcc:rewards-opened').length, 1);
  app.setPhase('closed');
  app.triggerMutation();
  app.flush();
  app.setPhase('list');
  app.triggerMutation();
  app.flush();
  assert.equal(app.dispatchedEvents.filter(e => e.type === 'tcc:rewards-opened').length, 2);
});

test('tcc:rewards-preview updates custom dimensions live and triggers auto-open once', () => {
  const app = setup(false, false, false, {}, {
    withDialogTrigger: true,
    initialPhase: 'closed',
    openOnTriggerClick: false
  });
  app.window.dispatchEvent(
    new app.CustomEvent('tcc:rewards-preview', {
      detail: {
        settings: { enabled: true, rewards: { widthPx: 460, heightPx: 620 } },
        openPicker: true
      }
    })
  );
  assert.equal(app.docStyle['--tcc-rewards-width'], '460px');
  assert.equal(app.docStyle['--tcc-rewards-height'], '620px');
  assert.equal(app.triggerClicks, 1);
  // Rapid second preview event inside cooldown window must not double-toggle the trigger button.
  app.window.dispatchEvent(
    new app.CustomEvent('tcc:rewards-preview', {
      detail: {
        settings: { enabled: true, rewards: { widthPx: 480, heightPx: 640 } },
        openPicker: true
      }
    })
  );
  assert.equal(app.docStyle['--tcc-rewards-width'], '480px');
  assert.equal(app.docStyle['--tcc-rewards-height'], '640px');
  assert.equal(app.triggerClicks, 1);
  // Once open and prechecking, preview updates snapshot dimensions directly too.
  app.setPhase('list');
  app.flush();
  app.window.dispatchEvent(
    new app.CustomEvent('tcc:rewards-preview', {
      detail: { settings: { enabled: true, rewards: { widthPx: 500, heightPx: 650 } }, openPicker: false }
    })
  );
  assert.equal(app.docStyle['--tcc-rewards-width'], '500px');
  assert.equal(app.docStyle['--tcc-rewards-height'], '650px');
});

test('dragging a rewards resize handle updates dimensions live and saves on pointerup', () => {
  const app = setup(false, false, false, {rewards:{widthPx:420,heightPx:600}}, { withDialogTrigger: true, dialogWidth: 420 });
  const handles = app.dialogEl.querySelectorAll('.tcc-rewards-resize-handle');
  const nw = handles.find(h => h.dataset.tccResizeMode === 'nw');
  const ne = handles.find(h => h.dataset.tccResizeMode === 'ne');
  assert.ok(nw && ne);
  assert.equal(nw.hidden, false);
  assert.equal(ne.hidden, true);
  nw.pointerdown({ button: 0, clientX: 600, clientY: 650, preventDefault() {}, stopPropagation() {} });
  assert.ok(app.dialogEl.classList.contains('tcc-rewards-resizing'));
  assert.ok(nw.classList.contains('is-active'));
  app.window.dispatchEvent({ type: 'pointermove', clientX: 540, clientY: 580 });
  assert.equal(app.docStyle['--tcc-rewards-width'], '480px');
  assert.equal(app.docStyle['--tcc-rewards-height'], '670px');
  app.window.dispatchEvent({ type: 'pointerup' });
  assert.equal(app.dialogEl.classList.contains('tcc-rewards-resizing'), false);
  assert.equal(nw.classList.contains('is-active'), false);
  assert.equal(app.storageSets.length, 1);
  assert.equal(app.storageSets[0].tcc_settings.rewards.widthPx, 480);
  assert.equal(app.storageSets[0].tcc_settings.rewards.heightPx, 670);
});

test('popover anchors to the points button instead of the top of the composer', () => {
  const app = setup(false, false, false, {}, {
    withDialogTrigger: true,
    dialogLeft: 560,
    dialogWidth: 340,
    triggerRect: { left: 560, top: 1220, width: 120, height: 36, bottom: 1256 },
    chatInputRect: { left: 540, top: 1160, width: 470, height: 96, bottom: 1256 }
  });
  const rect = app.dialogEl.getBoundingClientRect();
  assert.equal(rect.left, 560);
  assert.equal(rect.bottom, 1212);
  assert.ok(rect.bottom > 1160);
  const handles = app.dialogEl.querySelectorAll('.tcc-rewards-resize-handle');
  assert.equal(handles.find(h => h.dataset.tccResizeMode === 'ne').hidden, false);
  assert.equal(handles.find(h => h.dataset.tccResizeMode === 'nw').hidden, true);
});

test('rewards percentage width mode sets vw CSS var and commits widthPct on drag release', () => {
  const app = setup(
    false,
    false,
    false,
    { rewards: { widthUnit: '%', widthPct: 30, heightPx: 540 } },
    { withDialogTrigger: true, dialogLeft: 660, dialogWidth: 307, triggerRect:{left:660,top:1220,width:120,height:36,bottom:1256} }
  );
  assert.equal(app.docStyle['--tcc-rewards-width'], '30vw');
  const ne = app.dialogEl.querySelectorAll('.tcc-rewards-resize-handle').find(h => h.dataset.tccResizeMode === 'ne');
  assert.equal(ne.hidden, false);
  ne.pointerdown({ button: 0, clientX: 967, clientY: 650, preventDefault() {}, stopPropagation() {} });
  app.window.dispatchEvent({ type: 'pointermove', clientX: 1069, clientY: 610 });
  assert.equal(app.docStyle['--tcc-rewards-width'], '39.94vw');
  app.window.dispatchEvent({ type: 'pointerup' });
  assert.equal(app.storageSets.length, 1);
  assert.equal(app.storageSets[0].tcc_settings.rewards.widthPct, 39.94);
  assert.equal(app.storageSets[0].tcc_settings.rewards.heightPx, 580);
});



test('built-in rewards with unknown input requirements never open their composer during precheck', () => {
  for (const rewardState of ['{}', '{"reward":{"id":"highlight","title":"Reward"}}', 'invalid']) {
    const app = setup(false, false, false, {}, {rewardState, composerOnInspect:true});
    assert.equal(app.phase,'list');
    assert.equal(app.confirmClicks,0);
    assert.equal(app.closeClicks,0);
    assert.equal(app.redeem.disabled,false);
    assert.equal(app.snapshot.removed,true);
  }
});


test('anchored coordinates stay fixed when native popover placement changes during precheck', () => {
  const app = setup(true,false,false,{}, {withDialogTrigger:true,deferFlush:true});
  app.flush(1);
  const initial = app.dialogEl.getBoundingClientRect();
  // Simulate Twitch writing a new transform/translation while moving into a detail view.
  app.dialogEl.style.translate = '80px -150px';
  app.triggerMutation();
  app.flush();
  assert.deepEqual(app.dialogEl.getBoundingClientRect(),initial);
  assert.equal(app.dialogEl.style.translate,undefined);
  assert.equal(app.confirmClicks,0);
});


test('percentage rewards picker follows successive single-pixel moves without coarse snapping', () => {
  const app=setup(false,false,false,{rewards:{widthUnit:'%',widthPct:30}}, {
    withDialogTrigger:true,triggerRect:{left:660,top:1220,width:120,height:36,bottom:1256}
  });
  const handle=app.dialogEl.querySelectorAll('.tcc-rewards-resize-handle').find(h=>h.dataset.tccResizeMode==='ne');
  handle.pointerdown({button:0,clientX:967,clientY:650,preventDefault(){},stopPropagation(){}});
  for(let delta=1;delta<=5;delta++) {
    app.window.dispatchEvent({type:'pointermove',clientX:967+delta,clientY:650});
    assert.equal(app.dialogEl.getBoundingClientRect().width,307+delta);
  }
  app.window.dispatchEvent({type:'pointerup'});
  assert.equal(app.storageSets[0].tcc_settings.rewards.widthPct,30.47);
});


test('insufficient-balance RequiredPoints button mirrors the native disabled flag', () => {
  const app=setup(true,false,false,{}, {confirmMarker:'RequiredPoints'});
  assert.equal(app.redeem.disabled,true);
  assert.equal(app.confirmClicks,0);
  app.start();
  assert.equal(app.confirmClicks,0);
});

test('RequiredPoints uses the native flag without calculating balance or cost', () => {
  const app=setup(false,false,false,{}, {confirmMarker:'RequiredPoints'});
  assert.equal(app.redeem.disabled,false);
  assert.equal(app.confirmClicks,0);
});


test('normal-mode transformed chat columns keep the fixed picker inside the viewport', () => {
  const app=setup(false,false,false,{}, {withDialogTrigger:true,fixedOriginX:2007,fixedOriginY:50});
  const rect=app.dialogEl.getBoundingClientRect();
  assert.equal(rect.left,676);
  assert.equal(rect.bottom,1212);
  assert.equal(rect.right,1016);
  app.triggerMutation(); app.flush();
  assert.deepEqual(app.dialogEl.getBoundingClientRect(),rect);
  assert.equal(app.confirmClicks,0);
});

for (const finalTop of [360, 0]) {
  test(`background checks preserve the latest list scroll position (${finalTop}px) after native list replacement`, () => {
    const app = setup(false, false, false, {}, { deferFlush: true, initialScrollTop: 120 });
    app.flush(1);
    assert.equal(app.snapshotScroll.scrollTop, 120);
    app.snapshotScroll.scrollTop = finalTop;
    app.flush();
    assert.equal(app.phase, 'list');
    assert.equal(app.snapshot.removed, true);
    assert.equal(app.nativeScroll.scrollTop, finalTop);
    assert.equal(app.confirmClicks, 0);
  });
}

test('a timed out background check preserves the scrolled snapshot when returning to the list', () => {
  const app = setup(true, false, false, {}, { deferFlush: true });
  app.flush(1);
  app.snapshotScroll.scrollTop = 240;
  for (const fn of [...app.timers.values()]) fn();
  app.flush();
  assert.equal(app.phase, 'list');
  assert.equal(app.nativeScroll.scrollTop, 240);
  assert.equal(app.confirmClicks, 0);
});
