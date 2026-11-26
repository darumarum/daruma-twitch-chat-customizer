(function (root) {
  'use strict';

  const TCC = root.TCC || {};
  const constants = TCC.constants;
  const emoteParser = TCC.emoteParser;
  const storage = TCC.storage;

  if (!constants || !emoteParser || !storage) return;

  const {
    BRIDGE_CHANNEL,
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    deepMergeSettings,
    extractChannelLoginFromUrl
  } = constants;

  let state = {
    settings: DEFAULT_SETTINGS,
    catalog: { groups: {}, updatedAt: 0 },
    favorites: [],
    groupOrder: [],
    collapsedGroups: []
  };

  let requestSeq = 0;
  const pendingRequests = new Map();
  const requestedAvatarIds = new Set();
  let lastHref = location.href;
  let lastChannelLogin = extractChannelLoginFromUrl(location.href);
  let currentChannel = { id: '', login: lastChannelLogin || '' };
  let nativePickerScanTimer = null;

  const chatWidth = TCC.createChatWidthManager(constants, {
    onWidthCommit: async (widthPatchOrPx) => {
      const patch = typeof widthPatchOrPx === 'number'
        ? { chatWidthPx: widthPatchOrPx }
        : widthPatchOrPx;
      const merged = await storage.saveSettings({ width: patch });
      state.settings = merged;
      chatWidth.applySettings(state.settings);
      emotePicker.updateState(state, { layoutOnly: true });
    }
  });

  const emotePicker = TCC.createEmotePickerManager({
    constants,
    storage,
    onInsertEmote: (emoteOrToken) => {
      const isObj = emoteOrToken && typeof emoteOrToken === 'object';
      // Favorites retain an ID across renames; send the current token for that ID.
      const selected = emoteParser.resolveEmote(state.catalog, emoteOrToken);
      const token = isObj ? selected.token : selected;
      return sendBridgeRequest(
        'INSERT_EMOTE',
        {
          token,
          emoteId: isObj ? selected.id || '' : '',
          setId: isObj ? selected.setId || '' : '',
          assetType: isObj ? selected.assetType || 'STATIC' : 'STATIC',
          appendSpace: true
        },
        'INSERT_EMOTE_RESULT',
        2000
      );
    },
    onRequestSync: () => syncEmotesForCurrentPage(),
    onFavoritesChange: async (nextFavorites) => {
      state.favorites = nextFavorites;
      await storage.saveFavorites(nextFavorites);
    },
    onGroupOrderChange: async (nextOrder) => {
      state.groupOrder = nextOrder;
      await storage.saveGroupOrder(nextOrder);
    },
    onCollapsedChange: async (nextCollapsed) => {
      state.collapsedGroups = nextCollapsed;
      await storage.saveCollapsedGroups(nextCollapsed);
    },
    onSizeCommit: async (pickerPatch) => {
      const merged = await storage.saveSettings({ picker: pickerPatch });
      state.settings = merged;
      emotePicker.updateState(state, { layoutOnly: true });
    }
  });

  function sendBridgeRequest(type, payload, expectedResponseType, timeoutMs = 6000) {
    const requestId = `tcc_${Date.now()}_${++requestSeq}`;
    return new Promise((resolve) => {
      let timer = null;
      if (expectedResponseType) {
        timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          resolve({ ok: false, reason: 'timeout' });
        }, timeoutMs);
        pendingRequests.set(requestId, { expectedResponseType, resolve, timer });
      }
      window.postMessage(
        Object.assign({ channel: BRIDGE_CHANNEL, type, requestId }, payload || {}),
        '*'
      );
      if (!expectedResponseType) {
        resolve({ ok: true });
      }
    });
  }

  function shouldApplyProfileUpdates(catalog, ownerProfiles) {
    const groups = (catalog && catalog.groups) || {};
    const profileValues = Object.values(ownerProfiles || {});
    if (profileValues.length === 0) return false;

    for (const gid of Object.keys(groups)) {
      const g = groups[gid];
      if (!g || g.type !== 'channel') continue;
      if (g.avatarUrl && g.displayName && g.displayName !== g.login) continue;
      const match =
        (g.ownerId && ownerProfiles[g.ownerId]) ||
        (g.login && ownerProfiles[`login:${g.login}`]) ||
        profileValues.find((p) => (g.ownerId && p.id === g.ownerId) || (g.login && p.login === g.login));
      if (match && ((match.avatarUrl && !g.avatarUrl) || (match.displayName && g.displayName !== match.displayName))) {
        return true;
      }
    }
    return false;
  }

  async function processExtractedCatalogData(extracted) {
    if (!extracted) return;
    const hasGroups = Array.isArray(extracted.groups) && extracted.groups.length > 0;
    const needsProfileUpdate = shouldApplyProfileUpdates(state.catalog, extracted.ownerProfiles);
    if (!hasGroups && !needsProfileUpdate && !extracted.completeViewerSnapshot &&
        !Object.keys(extracted.channelOnlyEmotes || {}).length) return;

    const updatedCatalog = await storage.mergeAndSaveCatalog(extracted);
    state.catalog = updatedCatalog;
    emotePicker.updateState(state);
    requestMissingAvatars();
  }

  function requestMissingAvatars() {
    const missing = storage.findMissingAvatarOwnerIds(state.catalog).filter((id) => !requestedAvatarIds.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requestedAvatarIds.add(id));
    window.postMessage(
      {
        channel: BRIDGE_CHANNEL,
        type: 'FETCH_MISSING_AVATARS',
        ownerIds: missing
      },
      '*'
    );
  }

  async function syncEmotesForCurrentPage() {
    const channelLogin = extractChannelLoginFromUrl(location.href) || '';
    const res = await sendBridgeRequest(
      'ACTIVE_FETCH_EMOTES',
      { channelLogin },
      'ACTIVE_FETCH_RESULT',
      9000
    );
    if (res && (res.channelID || res.channelLogin)) {
      currentChannel = {
        id: res.channelID ? String(res.channelID) : currentChannel.id,
        login: res.channelLogin ? String(res.channelLogin).toLowerCase() : currentChannel.login
      };
      emotePicker.setCurrentChannel(currentChannel);
    }
    requestMissingAvatars();
    return res;
  }

  function scanNativePickerDom() {
    const pickerEl = document.querySelector('[data-a-target="emote-picker"], .emote-picker');
    if (!pickerEl) return;
    const extracted = emoteParser.extractEmotesFromNativePickerDom(pickerEl);
    if (extracted.groups.length > 0) {
      processExtractedCatalogData(extracted);
    }
  }

  function startNativePickerDomWatcher() {
    if (!document.body) return;
    const observer = new MutationObserver((mutations) => {
      let sawPicker = false;
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.id === 'tcc-emote-picker-host') continue;
          if (
            (n.matches && n.matches('[data-a-target="emote-picker"], .emote-picker')) ||
            (n.querySelector && n.querySelector('[data-a-target="emote-picker"], .emote-picker'))
          ) {
            sawPicker = true;
            break;
          }
        }
        if (sawPicker) break;
      }
      if (sawPicker) {
        if (nativePickerScanTimer) clearTimeout(nativePickerScanTimer);
        nativePickerScanTimer = setTimeout(scanNativePickerDom, 450);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupBridgeMessageListener() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.channel !== BRIDGE_CHANNEL) return;

      if (data.type === 'GQL_RESPONSE' && data.payload) {
        const extracted = emoteParser.extractEmotesFromGqlPayload(data.payload, { completeViewerSnapshot: data.completeViewerSnapshot === true, permissionChannelId: data.permissionChannelId });
        processExtractedCatalogData(extracted);
        return;
      }

      if (data.requestId && pendingRequests.has(data.requestId)) {
        const entry = pendingRequests.get(data.requestId);
        if (!entry.expectedResponseType || entry.expectedResponseType === data.type) {
          clearTimeout(entry.timer);
          pendingRequests.delete(data.requestId);
          entry.resolve(data);
        }
      }
    });
  }

  function setupStorageSync() {
    storage.onChanged((changes) => {
      let settingsChanged = false;
      if (changes[STORAGE_KEYS.SETTINGS]) {
        state.settings = deepMergeSettings(
          DEFAULT_SETTINGS,
          changes[STORAGE_KEYS.SETTINGS].newValue || {}
        );
        settingsChanged = true;
      }
      if (changes[STORAGE_KEYS.CATALOG]) {
        state.catalog = changes[STORAGE_KEYS.CATALOG].newValue || { groups: {}, updatedAt: 0 };
      }
      if (changes[STORAGE_KEYS.FAVORITES]) {
        state.favorites = Array.isArray(changes[STORAGE_KEYS.FAVORITES].newValue)
          ? changes[STORAGE_KEYS.FAVORITES].newValue
          : [];
      }
      if (changes[STORAGE_KEYS.GROUP_ORDER]) {
        state.groupOrder = Array.isArray(changes[STORAGE_KEYS.GROUP_ORDER].newValue)
          ? changes[STORAGE_KEYS.GROUP_ORDER].newValue
          : [];
      }
      if (changes[STORAGE_KEYS.COLLAPSED_GROUPS]) {
        state.collapsedGroups = Array.isArray(changes[STORAGE_KEYS.COLLAPSED_GROUPS].newValue)
          ? changes[STORAGE_KEYS.COLLAPSED_GROUPS].newValue
          : [];
      }

      if (settingsChanged) {
        chatWidth.applySettings(state.settings);
      }
      emotePicker.updateState(state);
    });
  }

  function setupNavigationWatcher() {
    function checkHref() {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const nextLogin = extractChannelLoginFromUrl(lastHref);
      chatWidth.refreshColumnTarget();
      if (nextLogin !== lastChannelLogin) {
        lastChannelLogin = nextLogin;
        currentChannel = { id: '', login: nextLogin || '' };
        emotePicker.setCurrentChannel(currentChannel);
        setTimeout(() => syncEmotesForCurrentPage(), 900);
      }
    }

    window.addEventListener('popstate', checkHref);
    setInterval(checkHref, 1000);
  }

  function setupRuntimeMessages() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === 'TCC_TRIGGER_SYNC') {
          syncEmotesForCurrentPage().then((res) => sendResponse(res));
          return true;
        }
        if (msg && msg.type === 'TCC_PREVIEW_SETTINGS') {
          const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : null;
          if (patch) {
            state.settings = deepMergeSettings(state.settings, patch);
            if (patch.width || patch.chatEnabled !== undefined || patch.enabled !== undefined) {
              chatWidth.applySettings(state.settings);
            }
            if (patch.picker || patch.width || patch.enabled !== undefined) {
              const pickerKeys = patch.picker ? Object.keys(patch.picker) : [];
              const layoutOnly =
                patch.enabled === undefined &&
                pickerKeys.every(
                  (k) =>
                    k === 'pickerWidthUnit' ||
                    k === 'pickerWidthPx' ||
                    k === 'pickerWidthPct' ||
                    k === 'pickerHeightPx'
                );
              emotePicker.updateState(state, { layoutOnly });
            }
          }
          if (msg.openPicker === 'emote') {
            if (
              state.settings.enabled !== false &&
              state.settings.picker &&
              state.settings.picker.enabled !== false &&
              !emotePicker.isOpen() &&
              document.querySelector('[data-a-target="emote-picker-button"], .chat-input')
            ) {
              emotePicker.open();
            }
          }
          if (
            (patch && (patch.rewards || patch.enabled !== undefined)) ||
            msg.openPicker === 'rewards'
          ) {
            if (typeof CustomEvent === 'function') {
              window.dispatchEvent(
                new CustomEvent('tcc:rewards-preview', {
                  detail: {
                    settings: state.settings,
                    openPicker: msg.openPicker === 'rewards'
                  }
                })
              );
            }
          }
          sendResponse({ ok: true });
          return false;
        }
        return false;
      });
    }
  }

  async function bootstrap() {
    setupBridgeMessageListener();
    setupStorageSync();
    setupRuntimeMessages();

    state = await storage.loadAll();

    chatWidth.init(state.settings);
    emotePicker.init(state);
    emotePicker.setCurrentChannel(currentChannel);

    startNativePickerDomWatcher();
    setupNavigationWatcher();

    // Initial emote fetch shortly after page settles
    setTimeout(() => {
      syncEmotesForCurrentPage();
    }, 1200);
  }

  bootstrap();
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Development reloads wait for an empty draft and for pointer/redemption work
// to finish. Nothing is sent outside this extension.
(() => {
  if (window.top !== window) return;
  document.documentElement.setAttribute('data-tcc-dev-controller', '2');
  let pressed = false;
  let composing = false;
  let timer;
  document.addEventListener('pointerdown', () => { pressed = true; }, true);
  document.addEventListener('pointerup', () => { pressed = false; }, true);
  document.addEventListener('pointercancel', () => { pressed = false; }, true);
  window.addEventListener('blur', () => { pressed = false; });
  document.addEventListener('compositionstart', () => { composing = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; }, true);
  function safe() {
    if (pressed || composing || document.querySelector('.tcc-rewards-snapshot')) return false;
    return !Array.from(document.querySelectorAll('textarea[data-a-target="chat-input"], [data-slate-editor="true"]')).some(editor => {
      const text = typeof editor.value === 'string' ? editor.value : editor.textContent || '';
      return text.replace(/[\u200B\uFEFF\s]/g, '').length > 0 || Boolean(editor.querySelector('img'));
    });
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'TCC_DEV_RELOAD_STATUS') return false;
    reply({ safe: safe() }); return false;
  });
  function poll() {
    try {
      chrome.runtime.sendMessage({ type: 'TCC_DEV_RELOAD_POLL' }, response => {
        if (chrome.runtime.lastError) { clearInterval(timer); return; }
        if (response?.fingerprint) document.documentElement.setAttribute('data-tcc-dev-build', response.fingerprint);
        if (response?.enabled === false) clearInterval(timer);
      });
    } catch (_) { clearInterval(timer); }
  }
  timer = setInterval(poll, 2000);
  poll();
})();
