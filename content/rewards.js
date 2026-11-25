(() => {
  'use strict';
  const nativeDisabled = button => !button || button.disabled || button.getAttribute('aria-disabled') === 'true';
  function normalizeWidthUnit(unit) {
    const ext = globalThis.TCC?.constants?.normalizeWidthUnit;
    if (typeof ext === 'function') return ext(unit);
    return unit === '%' ? '%' : 'px';
  }
  function clampRewardsWidthPx(px) {
    const ext = globalThis.TCC?.constants?.clampRewardsWidthPx;
    if (typeof ext === 'function') return ext(px);
    const num = Number(px);
    return Number.isFinite(num) ? Math.min(900, Math.max(280, Math.round(num))) : 340;
  }
  function clampRewardsWidthPct(pct) {
    const ext = globalThis.TCC?.constants?.clampRewardsWidthPct;
    if (typeof ext === 'function') return ext(pct);
    const num = Number(pct);
    return Number.isFinite(num) ? Math.min(75, Math.max(15, Math.round(num * 100) / 100)) : 22;
  }
  function clampRewardsHeightPx(px) {
    const ext = globalThis.TCC?.constants?.clampRewardsHeightPx;
    if (typeof ext === 'function') return ext(px);
    const num = Number(px);
    return Number.isFinite(num) ? Math.min(850, Math.max(300, Math.round(num))) : 540;
  }
  function resolveRewardsConfig(rawSettings) {
    const root = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const r = root.rewards && typeof root.rewards === 'object' ? root.rewards : {};
    const enabled = root.enabled !== false && r.enabled !== false;
    const compactList = enabled;
    const oneClickRedeem = compactList && r.oneClickRedeem !== false;
    const precheckAvailability = oneClickRedeem && r.precheckAvailability !== false;
    const autoCloseOnRedeem = enabled && r.autoCloseOnRedeem !== false;
    const hideAllTab = enabled;
    const disableAnimation = enabled;
    const itemSize = r.itemSize === 'small' || r.itemSize === 'large' ? r.itemSize : 'medium';
    const widthUnit = normalizeWidthUnit(r.widthUnit);
    const widthPx = clampRewardsWidthPx(r.widthPx);
    const widthPct = clampRewardsWidthPct(r.widthPct);
    const heightPx = clampRewardsHeightPx(r.heightPx);
    return {
      enabled,
      compactList,
      oneClickRedeem,
      precheckAvailability,
      autoCloseOnRedeem,
      hideAllTab,
      disableAnimation,
      itemSize,
      widthUnit,
      widthPx,
      widthPct,
      heightPx
    };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { nativeDisabled, resolveRewardsConfig }; return; }
  let config = resolveRewardsConfig({});
  let scheduled = false;
  let pending = null;
  let checkedSession = false;
  let queuedAction = null;
  let filterWaitStartedAt = 0;
  let lastTriggerButton = null;
  let wasRewardsOpen = false;
  let autoOpenPendingUntil = 0;
  let activeResize = null;
  let hasAppliedSettings = false;
  const knownUnavailable = new Map();
  const rootSelector = '.reward-center__content';
  const closeSelector = 'button[aria-label="閉じる"], button[aria-label="Close"]';
  const toggleSelector = [
    'button[aria-label="ビッツとポイントの残高"]',
    'button[aria-label="Bits and Points balance"]',
    'button[aria-label="チャンネルポイント"]',
    'button[aria-label="Channel Points"]',
    'button[aria-label*="ポイント"]',
    'button[aria-label*="Channel Points"]',
    '[data-test-selector="community-points-summary"] button',
    '[data-a-target="community-points-summary"] button',
    '.community-points-summary button'
  ].join(', ');
  // Twitch replaces the normal label with RequiredPoints when the balance is insufficient.
  const confirmSelector = '[data-test-selector="RewardText"], [data-test-selector="RequiredPoints"]';
  const isDisabled = nativeDisabled;
  const isVisible = panel => panel.getClientRects().length > 0 && !panel.closest('.tw-transition[aria-hidden="true"]');
  const visiblePanel = () => Array.from(document.querySelectorAll(rootSelector)).find(isVisible);
  function setStyleVar(el, prop, val) {
    if (!el?.style) return;
    if (typeof el.style.setProperty === 'function') el.style.setProperty(prop, val);
    else el.style[prop] = val;
  }
  function clearStyleProp(el, prop, camelProp) {
    if (!el?.style) return;
    if (typeof el.style.removeProperty === 'function') el.style.removeProperty(prop);
    else delete el.style[camelProp];
  }
  function getViewportWidth() {
    const docW = document.documentElement?.clientWidth;
    if (Number.isFinite(docW) && docW > 0) return docW;
    if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
      return window.innerWidth;
    }
    return 1280;
  }
  function resolveEffectiveWidthPx(viewportWidth = getViewportWidth()) {
    const maxAllowed = Math.max(280, viewportWidth - 16);
    if (config.widthUnit === '%') {
      return Math.min(Math.max(280, Math.round((config.widthPct / 100) * viewportWidth)), maxAllowed);
    }
    return Math.min(config.widthPx, maxAllowed);
  }
  function notifyRewardsOpened() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('tcc:rewards-opened'));
    }
  }
  function syncRewardsOpenState() {
    const open = Boolean(visiblePanel());
    if (open) {
      autoOpenPendingUntil = 0;
      if (!wasRewardsOpen) {
        wasRewardsOpen = true;
        notifyRewardsOpened();
      }
    } else {
      wasRewardsOpen = false;
    }
  }
  function syncRootClasses() {
    const cls = document.documentElement?.classList;
    if (cls) {
      cls.toggle('tcc-rewards-root-enabled', config.enabled);
      cls.toggle('tcc-rewards-root-list', config.compactList);
      cls.toggle('tcc-rewards-root-hide-all', config.hideAllTab);
      cls.toggle('tcc-rewards-root-still', config.disableAnimation);
    }
    if (config.enabled) {
      const widthCss = config.widthUnit === '%' ? `${config.widthPct}vw` : `${config.widthPx}px`;
      setStyleVar(document.documentElement, '--tcc-rewards-width', widthCss);
      setStyleVar(document.documentElement, '--tcc-rewards-height', `${config.heightPx}px`);
    } else {
      clearStyleProp(document.documentElement, '--tcc-rewards-width', '--tcc-rewards-width');
      clearStyleProp(document.documentElement, '--tcc-rewards-height', '--tcc-rewards-height');
      clearStyleProp(document.documentElement, '--tcc-rewards-max-height', '--tcc-rewards-max-height');
    }
  }
  function isInsideRewardsUi(el) {
    if (!el) return false;
    return Boolean(
      el.matches?.(rootSelector) ||
      el.closest?.(rootSelector) ||
      el.closest?.('.tcc-rewards-snapshot') ||
      el.closest?.('.tcc-rewards-resize-handle') ||
      el.closest?.('#tcc-emote-picker-host') ||
      el.querySelector?.('.rewards-list, #channel-points-reward-center-header')
    );
  }
  function isToggleButton(btn) {
    if (!btn || isInsideRewardsUi(btn)) return false;
    if (lastTriggerButton && btn === lastTriggerButton) return true;
    return Boolean(btn.matches?.(toggleSelector));
  }
  function findToggleButton() {
    if (lastTriggerButton && lastTriggerButton.isConnected !== false && !isInsideRewardsUi(lastTriggerButton) && lastTriggerButton.getClientRects?.().length > 0) {
      return lastTriggerButton;
    }
    const candidates = document.querySelectorAll?.(toggleSelector);
    if (!candidates) return null;
    for (const el of candidates) {
      if (!isInsideRewardsUi(el) && el.getClientRects?.().length > 0) return el;
    }
    return null;
  }
  function dialogFor(panel) {
    const container = panel.closest?.('[role="dialog"]');
    return container && container !== document.body && container !== document.documentElement ? container : null;
  }
  function findAnchorTop(trigger) {
    const rect = trigger?.getBoundingClientRect?.();
    return rect && rect.height > 0 ? rect.top : null;
  }
  function computeMaxAllowedHeight() {
    const trigger = findToggleButton();
    const anchorTop = findAnchorTop(trigger);
    if (anchorTop == null || !(anchorTop > 120)) return null;
    const targetBottom = Math.floor(anchorTop - 8);
    return { targetBottom, maxAllowedHeight: Math.max(220, targetBottom - 8) };
  }
  function syncPanelClasses(panel) {
    panel.classList.toggle('tcc-rewards-enabled', config.enabled);
    panel.classList.toggle('tcc-rewards-list', config.compactList);
    panel.classList.toggle('tcc-rewards-hide-all', config.hideAllTab);
    panel.classList.toggle('tcc-rewards-size-small', config.compactList && config.itemSize === 'small');
    panel.classList.toggle('tcc-rewards-size-large', config.compactList && config.itemSize === 'large');
    panel.classList.toggle('tcc-rewards-passive-cost', config.compactList && !config.oneClickRedeem);
    dialogFor(panel)?.classList?.toggle('tcc-rewards-still', config.disableAnimation);
  }
  function lockPanelHeight(panel, heightPx) {
    if (!panel?.style || !(heightPx > 0)) return null;
    const prev = {
      panel,
      height: panel.style.height || '',
      minHeight: panel.style.minHeight || '',
      overflow: panel.style.overflow || ''
    };
    const px = `${Math.round(heightPx)}px`;
    panel.style.height = px;
    panel.style.minHeight = px;
    panel.style.overflow = 'hidden';
    setStyleVar(document.documentElement, '--tcc-snapshot-h', px);
    return prev;
  }
  function updatePanelHeightLock(lock, heightPx) {
    if (!lock?.panel?.style || !(heightPx > 0)) return;
    const px = `${Math.round(heightPx)}px`;
    lock.panel.style.height = px;
    lock.panel.style.minHeight = px;
    lock.panel.style.overflow = 'hidden';
    setStyleVar(document.documentElement, '--tcc-snapshot-h', px);
  }
  function unlockPanelHeight(lock) {
    clearStyleProp(document.documentElement, '--tcc-snapshot-h', '--tcc-snapshot-h');
    if (!lock?.panel?.style) return;
    const { panel, height, minHeight, overflow } = lock;
    if (height) panel.style.height = height; else clearStyleProp(panel, 'height', 'height');
    if (minHeight) panel.style.minHeight = minHeight; else clearStyleProp(panel, 'min-height', 'minHeight');
    if (overflow) panel.style.overflow = overflow; else clearStyleProp(panel, 'overflow', 'overflow');
  }
  function cursorClassForMode(mode) {
    if (mode === 'n') return 'tcc-picker-resizing-ns';
    if (mode === 'w' || mode === 'e') return 'tcc-picker-resizing-ew';
    if (mode === 'nw') return 'tcc-picker-resizing-nwse';
    return 'tcc-picker-resizing-nesw';
  }
  function persistRewardsSize(rewardsPatch) {
    const patch = Object.assign({}, rewardsPatch || {});
    if (patch.widthPx !== undefined) patch.widthPx = clampRewardsWidthPx(patch.widthPx);
    if (patch.widthPct !== undefined) patch.widthPct = clampRewardsWidthPct(patch.widthPct);
    if (patch.heightPx !== undefined) patch.heightPx = clampRewardsHeightPx(patch.heightPx);
    const storageApi = globalThis.TCC?.storage;
    if (storageApi && typeof storageApi.saveSettings === 'function') {
      storageApi.saveSettings({ rewards: patch });
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get && chrome.storage?.local?.set) {
      chrome.storage.local.get('tcc_settings', result => {
        const cur = result?.tcc_settings && typeof result.tcc_settings === 'object' ? result.tcc_settings : {};
        const prevRewards = cur.rewards && typeof cur.rewards === 'object' ? cur.rewards : {};
        const merged = Object.assign({}, cur, {
          rewards: Object.assign({}, prevRewards, patch)
        });
        chrome.storage.local.set({ tcc_settings: merged });
      });
    }
  }
  function removeResizeHandles(panel) {
    const container = dialogFor(panel);
    if (!container || typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('.tcc-rewards-resize-handle, .tcc-rewards-resize-badge').forEach(el => el.remove?.());
    container.classList?.remove('tcc-rewards-resizing');
  }
  function syncResizeHandles(panel, visualLeft, visualWidth, viewportWidth) {
    const container = dialogFor(panel);
    if (!container || typeof container.querySelectorAll !== 'function') return;
    const isRightPinned = (visualLeft + visualWidth) >= viewportWidth - 16;
    container.querySelectorAll('.tcc-rewards-resize-handle').forEach(el => {
      const mode = el.dataset?.tccResizeMode || '';
      if (mode === 'w' || mode === 'nw') el.hidden = !isRightPinned;
      else if (mode === 'e' || mode === 'ne') el.hidden = isRightPinned;
      else el.hidden = false;
    });
  }
  function syncLiveSizeOnVisiblePanel(panel) {
    if (!panel || !config.enabled) return;
    const vw = getViewportWidth();
    const bounds = computeMaxAllowedHeight();
    const effectiveW = resolveEffectiveWidthPx(vw);
    const effectiveH = bounds ? Math.min(config.heightPx, bounds.maxAllowedHeight) : config.heightPx;
    if (pending && (pending.phase === 'checking' || pending.phase === 'opening') && pending.snapshot?.style) {
      pending.snapshot.style.width = `${Math.round(effectiveW)}px`;
      pending.snapshot.style.height = `${Math.round(effectiveH)}px`;
      updatePanelHeightLock(pending.heightLock, effectiveH);
      positionPopover(panel, { measureEl: dialogFor(panel) || pending.snapshot || panel, lockHeight: true });
    } else {
      positionPopover(panel);
    }
  }
  function endRewardsResize(commit) {
    if (!activeResize) return;
    const session = activeResize;
    activeResize = null;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pointermove', session.onMove);
      window.removeEventListener('pointerup', session.onUp);
      window.removeEventListener('pointercancel', session.onCancel);
    }
    document.documentElement?.classList?.remove(session.cursorClass);
    session.container?.classList?.remove('tcc-rewards-resizing');
    session.handle?.classList?.remove('is-active');
    if (!commit) return;
    if (session.isPct) {
      if (session.curPct !== session.origPct || session.curH !== session.origH) {
        persistRewardsSize({ widthPct: session.curPct, heightPx: session.curH });
      }
    } else if (session.curW !== session.origW || session.curH !== session.origH) {
      persistRewardsSize({ widthPx: session.curW, heightPx: session.curH });
    }
  }
  function resetRewardsSize(mode, panel) {
    const hasHoriz = mode.includes('w') || mode.includes('e');
    const nextH = mode.includes('n') ? 540 : config.heightPx;
    if (config.widthUnit === '%') {
      const nextPct = hasHoriz ? 22 : config.widthPct;
      if (nextPct === config.widthPct && nextH === config.heightPx) return;
      config = Object.assign({}, config, { widthPct: nextPct, heightPx: nextH });
      syncRootClasses();
      syncLiveSizeOnVisiblePanel(panel);
      persistRewardsSize({ widthPct: nextPct, heightPx: nextH });
      return;
    }
    const nextW = hasHoriz ? 340 : config.widthPx;
    if (nextW === config.widthPx && nextH === config.heightPx) return;
    config = Object.assign({}, config, { widthPx: nextW, heightPx: nextH });
    syncRootClasses();
    syncLiveSizeOnVisiblePanel(panel);
    persistRewardsSize({ widthPx: nextW, heightPx: nextH });
  }
  function startRewardsResize(mode, panel, container, handle, event) {
    if (!config.enabled || event.button !== 0) return;
    if (pending && pending.phase !== 'checking') return;
    endRewardsResize(false);
    event.preventDefault?.();
    event.stopPropagation?.();

    const measureEl = pending?.snapshot && typeof pending.snapshot.getBoundingClientRect === 'function'
      ? pending.snapshot
      : panel;
    const rect = measureEl.getBoundingClientRect?.() || {};
    const vw = getViewportWidth();
    const isPct = config.widthUnit === '%';
    const startW = rect.width > 0 ? rect.width : resolveEffectiveWidthPx(vw);
    const startH = clampRewardsHeightPx(rect.height > 0 ? rect.height : config.heightPx);
    const startPct = isPct ? clampRewardsWidthPct((startW / vw) * 100) : config.widthPct;
    const startX = event.clientX;
    const startY = event.clientY;
    const cursorClass = cursorClassForMode(mode);

    const session = {
      container,
      handle,
      cursorClass,
      isPct,
      origW: config.widthPx,
      origPct: config.widthPct,
      origH: config.heightPx,
      curW: clampRewardsWidthPx(startW),
      curPct: startPct,
      curH: startH,
      onMove(ev) {
        const curVw = getViewportWidth();
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const rawW = mode.includes('w') ? startW - dx : mode.includes('e') ? startW + dx : startW;
        const nextH = mode.includes('n') ? clampRewardsHeightPx(startH - dy) : session.curH;
        session.curH = nextH;
        if (isPct) {
          const nextPct = mode.includes('w') || mode.includes('e')
            ? clampRewardsWidthPct((rawW / curVw) * 100)
            : session.curPct;
          session.curPct = nextPct;
          config = Object.assign({}, config, { widthPct: nextPct, heightPx: nextH });
        } else {
          const nextW = mode.includes('w') || mode.includes('e') ? clampRewardsWidthPx(rawW) : session.curW;
          session.curW = nextW;
          config = Object.assign({}, config, { widthPx: nextW, heightPx: nextH });
        }
        syncRootClasses();
        syncLiveSizeOnVisiblePanel(panel);
        const bounds = computeMaxAllowedHeight();
        const displayedH = bounds ? Math.min(nextH, bounds.maxAllowedHeight) : nextH;
        session.curH = clampRewardsHeightPx(displayedH);
        config = Object.assign({}, config, { heightPx: session.curH });
        syncRootClasses();
        if (session.badge) {
          session.badge.textContent = isPct
            ? `${session.curPct}% × ${Math.round(displayedH)} px`
            : `${session.curW} × ${Math.round(displayedH)} px`;
        }
      },
      onUp() {
        endRewardsResize(true);
      },
      onCancel() {
        endRewardsResize(false);
      }
    };
    session.badge = container.querySelector?.('.tcc-rewards-resize-badge') || null;
    if (session.badge) {
      session.badge.textContent = isPct
        ? `${startPct}% × ${startH} px`
        : `${clampRewardsWidthPx(startW)} × ${startH} px`;
    }
    activeResize = session;
    document.documentElement?.classList?.add(cursorClass);
    container.classList?.add('tcc-rewards-resizing');
    handle.classList?.add('is-active');
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pointermove', session.onMove);
      window.addEventListener('pointerup', session.onUp);
      window.addEventListener('pointercancel', session.onCancel);
    }
  }
  function ensureResizeHandles(panel) {
    if (!config.enabled) {
      removeResizeHandles(panel);
      return;
    }
    const container = dialogFor(panel);
    if (!container || typeof container.querySelector !== 'function' || typeof container.appendChild !== 'function') {
      return;
    }
    if (container.querySelector('.tcc-rewards-resize-handle')) return;
    const badge = document.createElement('div');
    badge.className = 'tcc-rewards-resize-badge';
    container.appendChild(badge);
    ['n', 'w', 'e', 'nw', 'ne'].forEach(mode => {
      const handle = document.createElement('div');
      handle.className = `tcc-rewards-resize-handle tcc-rewards-resize-${mode}`;
      if (handle.dataset) handle.dataset.tccResizeMode = mode;
      handle.addEventListener('pointerdown', ev => startRewardsResize(mode, panel, container, handle, ev));
      handle.addEventListener('dblclick', ev => {
        ev.preventDefault?.();
        ev.stopPropagation?.();
        resetRewardsSize(mode, panel);
      });
      container.appendChild(handle);
    });
  }
  function resetPopoverPosition(panel) {
    const targets = [panel, dialogFor(panel)];
    for (const target of targets) {
      if (!target) continue;
      target.classList?.remove('tcc-rewards-anchored');
      for (const prop of ['--tcc-rewards-left', '--tcc-rewards-top', '--tcc-rewards-box-width', '--tcc-rewards-box-height']) {
        clearStyleProp(target, prop, prop);
      }
      if (target.dataset?.tccRewardShiftX !== undefined || target.dataset?.tccRewardShiftY !== undefined || target.dataset?.tccRewardShift !== undefined) {
        clearStyleProp(target, 'translate', 'translate');
        delete target.dataset.tccRewardShiftX;
        delete target.dataset.tccRewardShiftY;
        delete target.dataset.tccRewardShift;
      }
    }
    if (panel.dataset?.tccRewardMaxHeight !== undefined) {
      clearStyleProp(panel, 'max-height', 'maxHeight');
      delete panel.dataset.tccRewardMaxHeight;
    }
    clearStyleProp(document.documentElement, '--tcc-rewards-max-height', '--tcc-rewards-max-height');
  }
  function positionPopover(panel, options = {}) {
    const container = dialogFor(panel);
    const trigger = findToggleButton();
    const bounds = computeMaxAllowedHeight();
    if (!container || !trigger || !bounds) return;

    // Anchor directly to the points button. Native popover repositioning must
    // not move the list between its initial paint, detail checks and return.
    const viewportWidth = getViewportWidth();
    const width = resolveEffectiveWidthPx(viewportWidth);
    const height = Math.min(config.heightPx, bounds.maxAllowedHeight);
    const triggerRect = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(triggerRect.left, viewportWidth - width - 8));
    const top = Math.max(8, bounds.targetBottom - height);
    setStyleVar(document.documentElement, '--tcc-rewards-max-height', `${bounds.maxAllowedHeight}px`);
    setStyleVar(container, '--tcc-rewards-left', `${Math.round(left)}px`);
    setStyleVar(container, '--tcc-rewards-top', `${Math.round(top)}px`);
    setStyleVar(container, '--tcc-rewards-box-width', `${Math.round(width)}px`);
    setStyleVar(container, '--tcc-rewards-box-height', `${Math.round(height)}px`);
    clearStyleProp(container, 'translate', 'translate');
    if (container.dataset) {
      delete container.dataset.tccRewardShiftX;
      delete container.dataset.tccRewardShiftY;
    }
    container.classList.add('tcc-rewards-anchored');
    // A transformed chat column is a containing block even for fixed dialogs.
    // Convert viewport coordinates into that block before the first paint.
    const actual = container.getBoundingClientRect();
    const offsetX = actual.left - Math.round(left);
    const offsetY = actual.top - Math.round(top);
    if (Number.isFinite(offsetX) && Math.abs(offsetX) > 0.5) {
      setStyleVar(container, '--tcc-rewards-left', `${Math.round(left - offsetX)}px`);
    }
    if (Number.isFinite(offsetY) && Math.abs(offsetY) > 0.5) {
      setStyleVar(container, '--tcc-rewards-top', `${Math.round(top - offsetY)}px`);
    }
    syncResizeHandles(panel, left, width, viewportWidth);
  }
  function stateFor(item) {
    try { return JSON.parse(item.dataset.tccRewardState || '{}'); } catch (_) { return {}; }
  }
  function rewardId(panel) {
    const src = panel.querySelector('.reward-icon__image img')?.getAttribute('src') || '';
    return src.match(/custom-reward-images\/\d+\/([^/]+)\//)?.[1];
  }
  function keyFor(id, title) { return location.pathname + ':' + (id || title); }
  function finish() {
    if (!pending) return;
    clearTimeout(pending.timer);
    // Background checks replace Twitch's list with detail views. The user
    // scrolls the snapshot, so transfer its latest position to the new list.
    const listScroll = pending.phase === 'checking' && pending.snapshot
      ? Array.from(pending.snapshot.querySelectorAll('.scrollable-area'), el => ({ top: el.scrollTop, left: el.scrollLeft }))
      : null;
    pending.snapshot?.remove();
    unlockPanelHeight(pending.heightLock);
    pending = null;
    document.documentElement.classList.remove('tcc-redeem-active');
    if (listScroll) {
      document.querySelectorAll(rootSelector).forEach(panel => {
        if (!isVisible(panel) || !panel.querySelector('.rewards-list')) return;
        panel.querySelectorAll('.scrollable-area').forEach((el, i) => {
          if (!listScroll[i]) return;
          el.scrollTop = listScroll[i].top;
          el.scrollLeft = listScroll[i].left;
        });
      });
    }
    schedule();
  }
  function closeVisibleRewards() {
    endRewardsResize(false);
    document.querySelectorAll(rootSelector).forEach(panel => {
      if (isVisible(panel)) panel.querySelector(closeSelector)?.click();
    });
    finish();
    autoOpenPendingUntil = 0;
    wasRewardsOpen = false;
  }
  function openRewardsPicker() {
    if (!config.enabled) return;
    if (visiblePanel()) {
      notifyRewardsOpened();
      return;
    }
    if (Date.now() < autoOpenPendingUntil) return;
    const trigger = findToggleButton();
    if (!trigger) return;
    autoOpenPendingUntil = Date.now() + 600;
    notifyRewardsOpened();
    trigger.click?.();
  }
  function armTimeout(ms) {
    clearTimeout(pending.timer);
    // Reveal Twitch's native view on timeout, so errors never remain hidden.
    pending.timer = setTimeout(() => {
      if (pending?.phase === 'checking') visiblePanel()?.querySelector('button[aria-label="戻る"], button[aria-label="Back"]')?.click();
      finish();
    }, ms);
  }
  function createSnapshot(panel, redeem) {
    const rect = panel.getBoundingClientRect();
    const clone = panel.cloneNode(true);
    clone.classList.remove('reward-center__content');
    clone.classList.add('tcc-rewards-snapshot');
    const container = dialogFor(panel);
    if (container) {
      clone.style.cssText += `;position:absolute;left:0;top:0;width:${rect.width}px;height:${rect.height}px;`;
    } else {
      clone.style.cssText += `;position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
    }
    clone.style.translate = 'none';
    clone.setAttribute('role', 'dialog');
    clone.setAttribute('aria-label', redeem ? '報酬を交換中' : '報酬一覧を確認中');
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    const originalButtons = Array.from(panel.querySelectorAll('.tcc-redeem'));
    const loading = redeem ? clone.querySelectorAll('.tcc-redeem')[originalButtons.indexOf(redeem)] : null;
    loading?.classList.add('tcc-loading');
    loading?.setAttribute('aria-busy', 'true');
    loading?.setAttribute('aria-label', '交換中');
    clone.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const close = clone.querySelector(closeSelector);
    if (close) {
      close.disabled = false;
      close.addEventListener('click', () => {
        closeVisibleRewards();
      });
    }
    if (!redeem) {
      // Keep footer buttons and filter tabs interactive while checking runs.
      const snapshotFooter = clone.lastElementChild;
      if (snapshotFooter && !snapshotFooter.querySelector?.('.rewards-list')) {
        snapshotFooter.querySelectorAll('button').forEach(button => { button.disabled = false; });
      }
      clone.querySelectorAll('[role="radio"], [role="radio"] button').forEach(el => { el.disabled = false; });
    }
    // Keep mirrored controls inside Twitch's dialog so its outside-click
    // handler does not dismiss the native view while a check is running.
    (container || document.body).appendChild(clone);
    const sourceScroll = panel.querySelectorAll('.scrollable-area');
    clone.querySelectorAll('.scrollable-area').forEach((el, i) => { el.scrollTop = sourceScroll[i]?.scrollTop || 0; });
    return clone;
  }
  function begin(panel, item, button, redeem) {
    if (pending || redeem.disabled || isDisabled(button)) return;
    const title = item.querySelector('p[title]').textContent.trim();
    const height = panel.getBoundingClientRect().height;
    pending = {
      title,
      rewardId: stateFor(item).reward?.id || rewardId(item),
      phase: 'opening',
      snapshot: createSnapshot(panel, redeem),
      heightLock: lockPanelHeight(panel, height)
    };
    document.documentElement.classList.add('tcc-redeem-active');
    armTimeout(2500);
    button.click();
    schedule();
  }
  function advanceCheck(panel) {
    if (!pending || pending.phase !== 'checking') return;
    if (pending.requested) { queuedAction = pending.requested; finish(); return; }
    const title = pending.queue.shift();
    if (!title) { finish(); return; }
    const item = Array.from(panel.querySelectorAll('[class*="rewardListItem--"]')).find(item => item.querySelector('p[title]')?.textContent.trim() === title);
    const button = item?.querySelector('button:not(.tcc-redeem)');
    if (!button) { advanceCheck(panel); return; }
    if (stateFor(item).reward?.isUserInputRequired !== false) {
      // Only explicitly input-free rewards are safe to inspect in the background.
      // Built-in rewards may omit this field and open the composer instead of a detail view.
      knownUnavailable.set(keyFor(null, title), { disabled: false, at: Date.now() });
      const row = Array.from(pending.snapshot.querySelectorAll('[class*="rewardListItem--"]')).find(item => item.querySelector('p[title]')?.textContent.trim() === title);
      const mirrored = row?.querySelector('.tcc-redeem');
      if (mirrored) { mirrored.disabled = false; mirrored.classList.remove('tcc-loading'); mirrored.removeAttribute('aria-busy'); }
      advanceCheck(panel);
      return;
    }
    pending.title = title;
    pending.step = 'detail';
    armTimeout(2500);
    button.click();
    schedule();
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.channel !== 'TCC_REWARDS_V1') return;
    if (!pending || pending.phase !== 'submitting') return;
    if (pending.rewardId && data.rewardId !== pending.rewardId) return;
    if (data.status === 'start') { if (!pending.requestId) pending.requestId = data.requestId; return; }
    if (!pending.requestId || pending.requestId !== data.requestId) return;
    if (data.status === 'success') {
      if (config.autoCloseOnRedeem) {
        document.querySelectorAll(rootSelector).forEach(panel => {
          if (isVisible(panel)) panel.querySelector(closeSelector)?.click();
        });
      } else if (pending.snapshot) {
        visiblePanel()?.querySelector('button[aria-label="戻る"], button[aria-label="Back"]')?.click();
      }
    }
    // Failed or unknown responses reveal Twitch's own error/status message.
    finish();
  });
  window.addEventListener('tcc:emote-picker-opened', () => {
    closeVisibleRewards();
  });
  window.addEventListener('tcc:rewards-preview', event => {
    const detail = event?.detail;
    if (!detail) return;
    if (detail.settings) applySettings(detail.settings);
    if (detail.openPicker) openRewardsPicker();
  });
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', () => {
      if (!config.enabled) return;
      const panel = visiblePanel();
      if (panel && !isWaitingAllTabSwitch(panel)) {
        syncLiveSizeOnVisiblePanel(panel);
      }
    }, { passive: true });
  }
  let pressedToggle = null;
  let panelAtPress = null;
  document.addEventListener('pointerdown', event => {
    const btn = event.target?.closest?.('button');
    pressedToggle = isToggleButton(btn) ? btn : null;
    if (pressedToggle) {
      lastTriggerButton = pressedToggle;
      panelAtPress = config.enabled ? visiblePanel() : null;
    } else {
      panelAtPress = null;
    }
  }, true);
  document.addEventListener('pointercancel', () => { pressedToggle = null; panelAtPress = null; }, true);
  document.addEventListener('click', event => {
    if (!config.enabled) return;
    const button = event.target?.closest?.('button');
    if (!button) return;
    // Also close after successful redemption initiated from the normal detail view.
    if (config.autoCloseOnRedeem && !pending && button.querySelector(confirmSelector) && !isDisabled(button)) {
      const panel = button.closest(rootSelector);
      if (panel) {
        pending = { title: panel.querySelector('#channel-points-reward-center-header')?.textContent.trim(), rewardId: rewardId(panel), phase: 'submitting' };
        armTimeout(15000);
      }
    }
    if (!isToggleButton(button)) return;
    lastTriggerButton = button;
    const panel = pressedToggle === button && event.detail !== 0 ? panelAtPress : visiblePanel();
    pressedToggle = null; panelAtPress = null;
    if (!panel) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (panel.isConnected !== false) panel.querySelector(closeSelector)?.click();
    finish();
  }, true);
  function switchFromAllTab(panel, hideAll) {
    const all = panel.querySelector('[data-a-target="reward-filter-all"]');
    const rewards = panel.querySelector('[data-a-target="reward-filter-rewards"]');
    const label = rewards?.querySelector('strong');
    if (!hideAll) {
      if (label?.dataset?.tccOrigLabel !== undefined && label.textContent !== label.dataset.tccOrigLabel) {
        label.textContent = label.dataset.tccOrigLabel;
      }
      return false;
    }
    if (label) {
      if (label.dataset && label.dataset.tccOrigLabel === undefined) label.dataset.tccOrigLabel = label.textContent;
      if (label.textContent !== 'チャネポ') label.textContent = 'チャネポ';
    }
    if (all?.getAttribute('aria-checked') === 'true' && rewards) {
      rewards.click();
      return true;
    }
    if (panel.querySelector('[class*="rewardListItem--"]') && panel.querySelector('[class*="bitsRewardListItem--"]')) {
      if (rewards && rewards.getAttribute('aria-checked') !== 'true') rewards.click();
      return true;
    }
    return false;
  }
  function isWaitingAllTabSwitch(panel) {
    if (!config.hideAllTab || !panel) return false;
    const all = panel.querySelector('[data-a-target="reward-filter-all"]');
    const rewards = panel.querySelector('[data-a-target="reward-filter-rewards"]');
    if (all?.getAttribute('aria-checked') === 'true' && rewards) return true;
    return Boolean(
      panel.querySelector('[class*="rewardListItem--"]') &&
      panel.querySelector('[class*="bitsRewardListItem--"]')
    );
  }
  function scan() {
    scheduled = false;
    syncRewardsOpenState();
    document.querySelectorAll(rootSelector).forEach(panel => {
      syncPanelClasses(panel);
      if (!config.enabled) {
        switchFromAllTab(panel, false);
        panel.classList.remove('tcc-rewards-filter-fallback');
        removeResizeHandles(panel);
        resetPopoverPosition(panel);
        return;
      }
      if (isVisible(panel)) {
        ensureResizeHandles(panel);
      }
      if (pending && isVisible(panel)) {
        positionPopover(panel, { measureEl: dialogFor(panel) || pending.snapshot || panel, lockHeight: true });
      }
      const heading = panel.querySelector('#channel-points-reward-center-header')?.textContent.trim();
      const confirm = panel.querySelector(confirmSelector)?.closest('button');
      const needsInput = Boolean(panel.querySelector('textarea, input:not([type="hidden"])'));
      if (pending?.phase === 'checking' && isVisible(panel)) {
        if (pending.step === 'detail' && heading === pending.title && !panel.querySelector('.rewards-list')) {
          if (pending.requested) {
            pending.step = 'returning';
            panel.querySelector('button[aria-label="戻る"], button[aria-label="Back"]')?.click();
            schedule();
            return;
          }
          // Use the actual native button flag, including offline, limits,
          // subscriber restrictions and missing required input.
          // A missing button means a choice/input view, not a locked reward.
          const disabled = confirm ? isDisabled(confirm) : false;
          if (confirm?.getAttribute('aria-busy') === 'true') { schedule(); return; }
          if (disabled) {
            pending.disabledSince ??= Date.now();
            if (Date.now() - pending.disabledSince < 120) { schedule(); return; }
          }
          pending.disabledSince = null;
          knownUnavailable.set(keyFor(null, heading), { disabled, at: Date.now() });
          const row = Array.from(pending.snapshot.querySelectorAll('[class*="rewardListItem--"]')).find(item => item.querySelector('p[title]')?.textContent.trim() === heading);
          const mirrored = row?.querySelector('.tcc-redeem');
          if (mirrored) {
            mirrored.disabled = disabled;
            mirrored.classList.remove('tcc-loading');
            mirrored.removeAttribute('aria-busy');
          }
          pending.step = 'returning';
          panel.querySelector('button[aria-label="戻る"], button[aria-label="Back"]')?.click();
          schedule();
          return;
        }
        if (pending.step === 'returning' && panel.querySelector('.rewards-list')) { advanceCheck(panel); return; }
      }
      if (confirm && !needsInput && isVisible(panel)) {
        const key = keyFor(null, heading);
        if (!pending || pending.phase === 'opening') knownUnavailable.set(key, { disabled: isDisabled(confirm), at: Date.now() });
      }
      if (pending?.phase === 'opening' && heading === pending.title && confirm && isVisible(panel)) {
        if (needsInput || isDisabled(confirm)) finish();
        else {
          pending.rewardId ||= rewardId(panel);
          pending.phase = 'submitting';
          armTimeout(15000);
          confirm.click();
        }
      }
      const waitingForFilter = switchFromAllTab(panel, config.hideAllTab);
      if (!pending && waitingForFilter) {
        filterWaitStartedAt ||= Date.now();
        if (Date.now() - filterWaitStartedAt < 1200) {
          panel.classList.remove('tcc-rewards-filter-fallback');
          schedule();
          return;
        }
        panel.classList.add('tcc-rewards-filter-fallback');
      } else if (!waitingForFilter) {
        filterWaitStartedAt = 0;
        panel.classList.remove('tcc-rewards-filter-fallback');
      }
      if (config.compactList) {
        panel.querySelectorAll('[class*="rewardListItem--"]').forEach(item => {
          const title = item.querySelector('p[title]');
          const button = item.querySelector('button:not(.tcc-redeem)');
          if (!title || !button) return;
          let redeem = item.querySelector('.tcc-redeem');
          if (!redeem) {
            redeem = document.createElement('button'); redeem.type = 'button'; redeem.className = 'tcc-redeem';
            redeem.addEventListener('click', event => {
              event.stopPropagation();
              if (config.oneClickRedeem) begin(panel, item, button, redeem);
              else button.click();
            });
            item.appendChild(redeem);
          }
          let name = button.querySelector('.tcc-reward-name');
          if (!name) { name = document.createElement('span'); name.className = 'tcc-reward-name'; button.appendChild(name); }
          if (name.textContent !== title.textContent) name.textContent = title.textContent;
          button.querySelector('.tcc-reward-cost')?.remove();
          const nativeCost = button.querySelector('.reward-icon__cost');
          const cost = nativeCost?.textContent.trim() || '';
          if (redeem.dataset.cost !== cost) {
            redeem.dataset.cost = cost;
            redeem.replaceChildren();
            const icon = nativeCost?.querySelector('img, svg');
            if (icon) { const copy = icon.cloneNode(true); copy.setAttribute('aria-hidden', 'true'); redeem.appendChild(copy); }
            const price = document.createElement('span'); price.textContent = cost; redeem.appendChild(price);
          }
          const rewardTitle = title.textContent.trim();
          redeem.setAttribute(
            'aria-label',
            config.oneClickRedeem ? `${rewardTitle}を${cost}ポイントで交換` : `${rewardTitle}の詳細を開く（${cost}ポイント）`
          );
          const cached = config.oneClickRedeem ? knownUnavailable.get(keyFor(null, rewardTitle)) : null;
          const disabled = Boolean(cached?.disabled);
          if (redeem.disabled !== disabled) redeem.disabled = disabled;
        });
      }
      if (!pending && isVisible(panel)) {
        positionPopover(panel);
      }
      if (!pending && queuedAction && isVisible(panel) && panel.querySelector('.rewards-list')) {
        const action = queuedAction; queuedAction = null;
        if (action.kind === 'footer') {
          const footer = panel.lastElementChild;
          if (footer && !footer.querySelector('.rewards-list')) {
            footer.querySelectorAll('button')[action.index]?.click();
          }
          return;
        }
        if (action.kind === 'radio') {
          const radios = Array.from(panel.querySelectorAll('[role="radio"]'));
          const radio =
            (action.target && radios.find(el => el.getAttribute?.('data-a-target') === action.target)) ||
            (action.index >= 0 ? radios[action.index] : null);
          radio?.click();
          return;
        }
        const item = Array.from(panel.querySelectorAll('[class*="rewardListItem--"]')).find(item => item.querySelector('p[title]')?.textContent.trim() === action.title);
        const button = item?.querySelector('button:not(.tcc-redeem)');
        if (button) {
          if (action.redeem && config.oneClickRedeem) begin(panel, item, button, item.querySelector('.tcc-redeem'));
          else button.click();
        }
        return;
      }
      if (config.precheckAvailability && !pending && !checkedSession && isVisible(panel) && panel.querySelector('.rewards-list')) {
        const queue = Array.from(panel.querySelectorAll('[class*="rewardListItem--"]')).map(item => item.querySelector('p[title]')?.textContent.trim()).filter(Boolean);
        if (queue.length) {
          checkedSession = true;
          const lockHeight = panel.getBoundingClientRect().height;
          pending = {
            phase: 'checking',
            queue,
            step: 'list',
            snapshot: createSnapshot(panel, null),
            heightLock: lockPanelHeight(panel, lockHeight)
          };
          pending.snapshot.querySelectorAll('[class*="rewardListItem--"]').forEach(item => {
            const button = item.querySelector('.tcc-redeem');
            const title = item.querySelector('p[title]')?.textContent.trim();
            if (button) button.disabled = Boolean(knownUnavailable.get(keyFor(null, title))?.disabled);
          });
          pending.snapshot.querySelectorAll('[class*="rewardListItem--"] > button:not(.tcc-redeem)').forEach(button => { button.disabled = false; });
          pending.snapshot.addEventListener('click', event => {
            if (pending?.phase !== 'checking') return;
            const radio = event.target?.closest?.('[role="radio"]');
            if (radio) {
              if (radio.disabled || radio.getAttribute?.('aria-disabled') === 'true') return;
              const target = radio.getAttribute?.('data-a-target') || '';
              const index = Array.from(pending.snapshot.querySelectorAll('[role="radio"]')).indexOf(radio);
              if (target || index !== -1) {
                pending.requested = { kind: 'radio', target, index };
                schedule();
              }
              return;
            }
            const button = event.target?.closest?.('button');
            if (!button || button.disabled) return;
            const row = button.closest?.('[class*="rewardListItem--"]');
            if (row) {
              const title = row.querySelector('p[title]')?.textContent.trim();
              if (title) { pending.requested = { kind: 'reward', title, redeem: button.classList.contains('tcc-redeem') }; schedule(); }
              return;
            }
            const snapshotFooter = pending.snapshot.lastElementChild;
            if (snapshotFooter && !snapshotFooter.querySelector?.('.rewards-list') && snapshotFooter.contains?.(button)) {
              const footerButtons = Array.from(snapshotFooter.querySelectorAll('button'));
              const index = footerButtons.indexOf(button);
              if (index !== -1) { pending.requested = { kind: 'footer', index }; schedule(); }
            }
          });
          document.documentElement.classList.add('tcc-redeem-active');
          advanceCheck(panel);
        }
      }
    });
    if (!document.querySelector(rootSelector)) {
      endRewardsResize(false);
      wasRewardsOpen = false;
      checkedSession = false;
      queuedAction = null;
      filterWaitStartedAt = 0;
      knownUnavailable.clear();
      if (pending) finish();
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } }
  function applySettings(rawSettings) {
    const initialLoad = !hasAppliedSettings;
    hasAppliedSettings = true;
    config = resolveRewardsConfig(rawSettings);
    syncRootClasses();
    if (!config.enabled) {
      endRewardsResize(false);
      finish();
    } else {
      if (!config.precheckAvailability) {
        if (pending?.phase === 'checking') {
          visiblePanel()?.querySelector('button[aria-label="戻る"], button[aria-label="Back"]')?.click();
          finish();
        }
        knownUnavailable.clear();
      }
      if (!config.oneClickRedeem && pending?.phase === 'opening') {
        finish();
      }
      const panel = !initialLoad ? visiblePanel() : null;
      if (panel && !isWaitingAllTabSwitch(panel)) {
        syncLiveSizeOnVisiblePanel(panel);
      }
    }
    schedule();
  }
  syncRootClasses();
  chrome.storage.local.get('tcc_settings', result => { applySettings(result?.tcc_settings); });
  chrome.storage.onChanged.addListener(changes => {
    if (changes.tcc_settings) applySettings(changes.tcc_settings.newValue);
  });
  new MutationObserver(() => {
    syncRewardsOpenState();
    if (config.enabled) {
      document.querySelectorAll(rootSelector).forEach(panel => {
        if (!isVisible(panel)) return;
        syncPanelClasses(panel);
        ensureResizeHandles(panel);
        const waiting = config.hideAllTab ? switchFromAllTab(panel, true) : false;
        if (pending) positionPopover(panel, { measureEl: dialogFor(panel) || pending.snapshot || panel, lockHeight: true });
        else if (!waiting) positionPopover(panel);
      });
    }
    schedule();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'aria-checked', 'data-tcc-reward-state']
  });
  schedule();
})();
