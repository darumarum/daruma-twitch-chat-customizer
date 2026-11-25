(function (root) {
  'use strict';

  root.TCC = root.TCC || {};

  function createChatWidthManager(constants, options = {}) {
    const {
      DEFAULT_SETTINGS,
      normalizeWidthUnit,
      clampChatWidthPx,
      clampChatWidthPct,
      resolveChatWidthPx
    } = constants;
    const onWidthCommit = typeof options.onWidthCommit === 'function' ? options.onWidthCommit : () => {};

    function getWidthUnit() {
      return normalizeWidthUnit(currentSettings && currentSettings.width && currentSettings.width.chatWidthUnit);
    }

    let currentSettings = DEFAULT_SETTINGS;
    let rightColEl = null;
    let channelRightColEl = null;
    let liveChatAsideEl = null;
    let channelRootEl = null;
    let handleEl = null;
    let tooltipEl = null;
    let attrObservers = [];
    let colResizeObserver = null;
    let domCheckTimer = null;
    let isDragging = false;
    let activeDragPx = null;
    let dispatchingResize = false;
    let notifyResizeTimer = null;
    let lastSyncedLayoutKey = '';

    function isWidthApplicablePage() {
      const host = location.hostname.toLowerCase();
      if (host !== 'www.twitch.tv' && host !== 'twitch.tv') return false;
      const path = location.pathname.toLowerCase();
      if (path.startsWith('/popout/') || path.startsWith('/embed/')) return false;
      return true;
    }

    function findRightColumn() {
      return (
        document.querySelector('.right-column') ||
        document.querySelector('.channel-root__right-column')
      );
    }

    function findChannelRightColumn() {
      return document.querySelector('.channel-root__right-column');
    }

    function findChannelRoot() {
      return document.querySelector('.channel-root');
    }

    function findLiveChatAside(channelCol) {
      if (!channelCol || !channelCol.closest) return null;
      return channelCol.closest('aside, #live-page-chat, [aria-hidden]');
    }

    function getVisualChatElement(theatre) {
      if (!theatre && channelRightColEl && channelRightColEl.isConnected) {
        return channelRightColEl;
      }
      return rightColEl;
    }

    function isRightColumnCollapsed(col, channelCol, theatre) {
      if (!col) return true;
      if (
        col.classList.contains('right-column--collapsed') ||
        col.classList.contains('right-column--below')
      ) {
        return true;
      }
      if (theatre) {
        const rect = col.getBoundingClientRect();
        return rect.width <= 1 || rect.height <= 1;
      }
      if (channelCol) {
        if (channelCol.closest && channelCol.closest('[aria-hidden="true"]')) {
          return true;
        }
        if (
          channelCol.classList.contains('channel-root__right-column--collapsed') ||
          !channelCol.classList.contains('channel-root__right-column--expanded')
        ) {
          return true;
        }
        const rootEl =
          channelRootEl && channelRootEl.isConnected ? channelRootEl : findChannelRoot();
        if (
          rootEl &&
          rootEl.classList.contains('channel-root--home') &&
          !rootEl.classList.contains('channel-root--watch-chat')
        ) {
          return true;
        }
        const inlineTf = (channelCol.style && channelCol.style.transform) || '';
        if (!/translateX\s*\(\s*-/i.test(inlineTf)) {
          return true;
        }
        const rect = channelCol.getBoundingClientRect();
        return rect.height <= 10;
      }
      const rect = col.getBoundingClientRect();
      return rect.width <= 1 || rect.height <= 1;
    }

    function isWidthFeatureEnabled() {
      return Boolean(
        currentSettings &&
          currentSettings.enabled &&
          currentSettings.chatEnabled !== false &&
          currentSettings.width &&
          currentSettings.width.enabled &&
          isWidthApplicablePage() &&
          rightColEl
      );
    }

    function isTheatreMode(col) {
      if (col && col.classList.contains('right-column--theatre')) return true;
      if (document.querySelector('.right-column--theatre, .persistent-player--theatre, .video-player--theatre')) {
        return true;
      }
      const player = document.querySelector('.persistent-player');
      if (player) {
        try {
          const cs = getComputedStyle(player);
          const rect = player.getBoundingClientRect();
          if (cs.position === 'fixed' && rect.height >= window.innerHeight * 0.85) {
            return true;
          }
        } catch (_) {}
      }
      return false;
    }

    function notifyTwitchLayoutResize() {
      if (notifyResizeTimer) clearTimeout(notifyResizeTimer);
      notifyResizeTimer = setTimeout(() => {
        notifyResizeTimer = null;
        dispatchingResize = true;
        try {
          window.dispatchEvent(new Event('resize'));
        } finally {
          dispatchingResize = false;
        }
      }, 80);
    }

    function syncRootState() {
      const html = document.documentElement;
      if (!html) return;

      const enabled = isWidthFeatureEnabled();
      const theatreRaw = Boolean(enabled && rightColEl && isTheatreMode(rightColEl));
      const collapsed = isRightColumnCollapsed(rightColEl, channelRightColEl, theatreRaw);
      const isTheatreActive = enabled && !collapsed && theatreRaw;
      const isNormalWatch = enabled && !collapsed && !isTheatreActive && Boolean(channelRightColEl);
      const isVodWatch = enabled && !collapsed && !isTheatreActive && !channelRightColEl;

      const effectivePx =
        activeDragPx !== null
          ? Math.min(Math.max(240, Math.round(activeDragPx)), Math.max(240, window.innerWidth - 320))
          : resolveChatWidthPx(currentSettings && currentSettings.width, window.innerWidth);

      html.classList.toggle('tcc-width-enabled', enabled);
      html.classList.toggle('tcc-chat-collapsed', enabled && collapsed);
      html.classList.toggle('tcc-theatre-mode', isTheatreActive);
      html.classList.toggle('tcc-normal-watch', isNormalWatch);
      html.classList.toggle('tcc-vod-watch', isVodWatch);
      html.classList.remove('tcc-normal-translate', 'tcc-normal-flex', 'tcc-clamp-player');
      html.style.setProperty('--tcc-chat-width', `${effectivePx}px`);

      let fitPlayerWidth = '';
      if (isNormalWatch) {
        const chatLeft = window.innerWidth - effectivePx;
        const player = document.querySelector('.persistent-player');
        if (player) {
          try {
            const cs = getComputedStyle(player);
            const pRect = player.getBoundingClientRect();
            const baseLeft = pRect.left >= 0 ? pRect.left : 0;
            if (cs.position === 'absolute' && pRect.top < 140 && chatLeft - baseLeft >= 320) {
              const availW = Math.max(320, Math.floor(chatLeft - baseLeft));
              fitPlayerWidth = `${availW}px`;
            }
          } catch (_) {}
        }
      }

      if (fitPlayerWidth) {
        html.style.setProperty('--tcc-player-width', fitPlayerWidth);
        html.classList.add('tcc-fit-normal-player');
      } else {
        html.classList.remove('tcc-fit-normal-player');
      }

      const layoutKey = `${enabled}|${collapsed}|${isTheatreActive}|${isNormalWatch}|${isVodWatch}|${effectivePx}`;
      if (layoutKey !== lastSyncedLayoutKey) {
        const hadPrevious = lastSyncedLayoutKey !== '';
        lastSyncedLayoutKey = layoutKey;
        if (hadPrevious && !isDragging) {
          notifyTwitchLayoutResize();
        }
      }
    }

    function updateHandlePosition() {
      if (!handleEl) return;

      const theatreRaw = Boolean(rightColEl && isTheatreMode(rightColEl));
      const visualEl = getVisualChatElement(theatreRaw);
      const showHandle =
        isWidthFeatureEnabled() &&
        Boolean(currentSettings.width.showResizeHandle) &&
        !isRightColumnCollapsed(rightColEl, channelRightColEl, theatreRaw) &&
        visualEl &&
        visualEl.isConnected;

      if (!showHandle) {
        handleEl.style.display = 'none';
        return;
      }

      const rect = visualEl.getBoundingClientRect();
      if (rect.width <= 10 || rect.height <= 10 || rect.left <= 0 || rect.left >= window.innerWidth - 20) {
        handleEl.style.display = 'none';
        return;
      }

      handleEl.style.display = 'block';
      handleEl.style.left = `${Math.round(rect.left - 3)}px`;
      handleEl.style.top = `${Math.round(rect.top)}px`;
      handleEl.style.height = `${Math.round(rect.height)}px`;

      if (tooltipEl && !isDragging) {
        if (getWidthUnit() === '%') {
          const pct = clampChatWidthPct(
            currentSettings && currentSettings.width
              ? currentSettings.width.chatWidthPct
              : DEFAULT_SETTINGS.width.chatWidthPct
          );
          tooltipEl.textContent = `${pct}%`;
        } else {
          const px = clampChatWidthPx(
            activeDragPx !== null
              ? activeDragPx
              : currentSettings && currentSettings.width
                ? currentSettings.width.chatWidthPx
                : DEFAULT_SETTINGS.width.chatWidthPx
          );
          tooltipEl.textContent = `${px}px`;
        }
      }
    }

    function commitWidthPatch(widthPatch) {
      const patch = typeof widthPatch === 'number' ? { chatWidthPx: widthPatch } : (widthPatch || {});
      const nextWidth = Object.assign({}, currentSettings.width || DEFAULT_SETTINGS.width, patch);
      if (patch.chatWidthPx !== undefined) nextWidth.chatWidthPx = clampChatWidthPx(patch.chatWidthPx);
      if (patch.chatWidthPct !== undefined) nextWidth.chatWidthPct = clampChatWidthPct(patch.chatWidthPct);
      currentSettings = Object.assign({}, currentSettings, { width: nextWidth });
      activeDragPx = null;
      const effectivePx = resolveChatWidthPx(currentSettings.width, window.innerWidth);
      document.documentElement.style.setProperty('--tcc-chat-width', `${effectivePx}px`);
      if (tooltipEl) {
        tooltipEl.textContent = getWidthUnit() === '%'
          ? `${clampChatWidthPct(nextWidth.chatWidthPct)}%`
          : `${clampChatWidthPx(nextWidth.chatWidthPx)}px`;
      }
      syncRootState();
      updateHandlePosition();
      notifyTwitchLayoutResize();
      onWidthCommit(patch);
    }

    function ensureResizeHandle() {
      if (handleEl && handleEl.isConnected) return handleEl;
      if (!document.body) return null;

      handleEl = document.createElement('div');
      handleEl.id = 'tcc-chat-resize-handle';
      handleEl.title = 'ドラッグでチャット幅を変更（ダブルクリックで初期値にリセット）';
      handleEl.style.display = 'none';

      tooltipEl = document.createElement('div');
      tooltipEl.className = 'tcc-resize-tooltip';
      handleEl.appendChild(tooltipEl);

      let startX = 0;
      let startWidthPx = DEFAULT_SETTINGS.width.chatWidthPx;
      let latestPx = DEFAULT_SETTINGS.width.chatWidthPx;
      let latestPct = DEFAULT_SETTINGS.width.chatWidthPct;

      handleEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !rightColEl) return;
        const visualEl = getVisualChatElement(isTheatreMode(rightColEl));
        if (!visualEl) return;
        e.preventDefault();
        e.stopPropagation();

        isDragging = true;
        startX = e.clientX;
        startWidthPx = Math.round(visualEl.getBoundingClientRect().width) || DEFAULT_SETTINGS.width.chatWidthPx;

        if (getWidthUnit() === '%') {
          latestPct = clampChatWidthPct((startWidthPx / Math.max(1, window.innerWidth) * 100));
          activeDragPx = Math.round((latestPct / 100) * window.innerWidth);
          if (tooltipEl) tooltipEl.textContent = `${latestPct}%`;
        } else {
          latestPx = clampChatWidthPx(startWidthPx);
          activeDragPx = latestPx;
          if (tooltipEl) tooltipEl.textContent = `${latestPx}px`;
        }

        handleEl.classList.add('tcc-dragging');
        document.documentElement.classList.add('tcc-resizing');
        try {
          handleEl.setPointerCapture(e.pointerId);
        } catch (_) {}
      });

      handleEl.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const deltaX = startX - e.clientX;
        const rawPx = startWidthPx + deltaX;
        if (getWidthUnit() === '%') {
          latestPct = clampChatWidthPct((rawPx / Math.max(1, window.innerWidth) * 100));
          activeDragPx = Math.round((latestPct / 100) * window.innerWidth);
          if (tooltipEl) tooltipEl.textContent = `${latestPct}%`;
        } else {
          latestPx = clampChatWidthPx(rawPx);
          activeDragPx = latestPx;
          if (tooltipEl) tooltipEl.textContent = `${latestPx}px`;
        }
        syncRootState();
        updateHandlePosition();
      });

      function finishDrag(e) {
        if (!isDragging) return;
        isDragging = false;
        handleEl.classList.remove('tcc-dragging');
        document.documentElement.classList.remove('tcc-resizing');
        try {
          if (e && e.pointerId != null) {
            handleEl.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}
        commitWidthPatch(getWidthUnit() === '%' ? { chatWidthPct: latestPct } : { chatWidthPx: latestPx });
      }

      handleEl.addEventListener('pointerup', finishDrag);
      handleEl.addEventListener('pointercancel', finishDrag);

      handleEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        commitWidthPatch(
          getWidthUnit() === '%'
            ? { chatWidthPct: DEFAULT_SETTINGS.width.chatWidthPct }
            : { chatWidthPx: DEFAULT_SETTINGS.width.chatWidthPx }
        );
      });

      document.body.appendChild(handleEl);
      return handleEl;
    }

    function disconnectObservers() {
      for (let i = 0; i < attrObservers.length; i++) {
        attrObservers[i].disconnect();
      }
      attrObservers = [];
      if (colResizeObserver) {
        colResizeObserver.disconnect();
        colResizeObserver = null;
      }
    }

    function observeTargetAttributes(el, attributeFilter) {
      if (!el) return;
      const obs = new MutationObserver(() => {
        syncRootState();
        updateHandlePosition();
      });
      obs.observe(el, { attributes: true, attributeFilter });
      attrObservers.push(obs);
    }

    function attachTargets(col, channelCol, asideEl, rootEl) {
      const targetChannelCol = channelCol || null;
      const targetAsideEl = asideEl || null;
      const targetRootEl = rootEl || null;

      if (
        rightColEl === col &&
        channelRightColEl === targetChannelCol &&
        liveChatAsideEl === targetAsideEl &&
        channelRootEl === targetRootEl &&
        col &&
        col.isConnected &&
        (!targetChannelCol || targetChannelCol.isConnected) &&
        (!targetAsideEl || targetAsideEl.isConnected) &&
        (!targetRootEl || targetRootEl.isConnected)
      ) {
        syncRootState();
        updateHandlePosition();
        return;
      }

      disconnectObservers();

      rightColEl = col;
      channelRightColEl = targetChannelCol;
      liveChatAsideEl = targetAsideEl;
      channelRootEl = targetRootEl;

      if (!rightColEl) {
        syncRootState();
        updateHandlePosition();
        return;
      }

      ensureResizeHandle();

      observeTargetAttributes(rightColEl, ['class', 'style']);
      if (channelRightColEl && channelRightColEl !== rightColEl) {
        observeTargetAttributes(channelRightColEl, ['class', 'style']);
      }
      if (liveChatAsideEl && liveChatAsideEl !== rightColEl && liveChatAsideEl !== channelRightColEl) {
        observeTargetAttributes(liveChatAsideEl, ['aria-hidden', 'class', 'style']);
      }
      if (channelRootEl) {
        observeTargetAttributes(channelRootEl, ['class']);
      }

      if (typeof ResizeObserver !== 'undefined') {
        colResizeObserver = new ResizeObserver(() => {
          syncRootState();
          updateHandlePosition();
        });
        colResizeObserver.observe(rightColEl);
        if (channelRightColEl && channelRightColEl !== rightColEl) {
          colResizeObserver.observe(channelRightColEl);
        }
        if (channelRootEl) {
          colResizeObserver.observe(channelRootEl);
        }
      }

      syncRootState();
      updateHandlePosition();
    }

    function refreshColumnTarget() {
      if (!isWidthApplicablePage()) {
        attachTargets(null, null, null, null);
        return;
      }
      const col = findRightColumn();
      const channelCol = findChannelRightColumn();
      const asideEl = findLiveChatAside(channelCol);
      const rootEl = findChannelRoot();
      attachTargets(col, channelCol, asideEl, rootEl);
    }

    function applySettings(settings) {
      currentSettings = settings || DEFAULT_SETTINGS;
      refreshColumnTarget();
    }

    function onWindowResize() {
      if (dispatchingResize) return;
      syncRootState();
      updateHandlePosition();
    }

    function init(settings) {
      currentSettings = settings || DEFAULT_SETTINGS;
      refreshColumnTarget();
      window.addEventListener('resize', onWindowResize, { passive: true });
      if (!domCheckTimer) {
        domCheckTimer = setInterval(() => {
          const applicable = isWidthApplicablePage();
          const found = applicable ? findRightColumn() : null;
          const foundChannel = applicable ? findChannelRightColumn() : null;
          const foundAside = applicable ? findLiveChatAside(foundChannel) : null;
          const foundRoot = applicable ? findChannelRoot() : null;
          if (
            found !== rightColEl ||
            foundChannel !== channelRightColEl ||
            foundAside !== liveChatAsideEl ||
            foundRoot !== channelRootEl ||
            (rightColEl && !rightColEl.isConnected) ||
            (channelRightColEl && !channelRightColEl.isConnected) ||
            (liveChatAsideEl && !liveChatAsideEl.isConnected) ||
            (channelRootEl && !channelRootEl.isConnected)
          ) {
            attachTargets(found, foundChannel, foundAside, foundRoot);
          } else if (rightColEl) {
            syncRootState();
            updateHandlePosition();
          }
        }, 800);
      }
    }

    function destroy() {
      window.removeEventListener('resize', onWindowResize);
      if (domCheckTimer) {
        clearInterval(domCheckTimer);
        domCheckTimer = null;
      }
      disconnectObservers();
      if (handleEl && handleEl.parentNode) {
        handleEl.parentNode.removeChild(handleEl);
        handleEl = null;
      }
      if (notifyResizeTimer) {
        clearTimeout(notifyResizeTimer);
        notifyResizeTimer = null;
      }
      const html = document.documentElement;
      if (html) {
        html.classList.remove(
          'tcc-width-enabled',
          'tcc-chat-collapsed',
          'tcc-theatre-mode',
          'tcc-normal-watch',
          'tcc-vod-watch',
          'tcc-fit-normal-player',
          'tcc-normal-translate',
          'tcc-normal-flex',
          'tcc-clamp-player',
          'tcc-resizing'
        );
      }
    }

    return {
      init,
      applySettings,
      refreshColumnTarget,
      destroy
    };
  }

  root.TCC.createChatWidthManager = createChatWidthManager;
})(typeof globalThis !== 'undefined' ? globalThis : this);
