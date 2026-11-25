(function (root) {
  'use strict';

  root.TCC = root.TCC || {};

  function createEmotePickerManager(deps) {
    const { constants, storage } = deps;
    const {
      DEFAULT_SETTINGS,
      EMOTE_SIZE_PX,
      getEmoteImageUrl,
      normalizeWidthUnit,
      clampPickerWidthPx,
      clampPickerWidthPct,
      clampPickerHeight,
      resolvePickerWidthPx
    } = constants;

    const onInsertEmote = typeof deps.onInsertEmote === 'function' ? deps.onInsertEmote : async () => ({ ok: false });
    const onRequestSync = typeof deps.onRequestSync === 'function' ? deps.onRequestSync : async () => {};
    const onFavoritesChange = typeof deps.onFavoritesChange === 'function' ? deps.onFavoritesChange : async () => {};
    const onGroupOrderChange = typeof deps.onGroupOrderChange === 'function' ? deps.onGroupOrderChange : async () => {};
    const onCollapsedChange = typeof deps.onCollapsedChange === 'function' ? deps.onCollapsedChange : async () => {};
    const onSizeCommit = typeof deps.onSizeCommit === 'function' ? deps.onSizeCommit : async () => {};

    const REWARDS_TRIGGER_SELECTOR = [
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

    let state = {
      settings: DEFAULT_SETTINGS,
      catalog: { groups: {}, updatedAt: 0 },
      favorites: [],
      groupOrder: [],
      collapsedGroups: []
    };

    let currentChannel = { id: '', login: '' };

    let isOpen = false;
    let isSyncing = false;
    let searchQuery = '';
    let activeNavId = '__favorites__';
    let currentTheme = 'dark';
    let bypassNativeClick = false;
    let nativeOpenAtMouseDown = false;
    let suppressNextClick = false;
    let lastAnchorButton = null;
    let scrollSpyRaf = false;
    let sectionScrollRaf = null;

    let hostEl = null;
    let shadowRoot = null;
    let panelEl = null;
    let searchInputEl = null;
    let searchClearEl = null;
    let syncBtnEl = null;
    let navListEl = null;
    let navFavBtnEl = null;
    let scrollAreaEl = null;
    let themeObserver = null;
    let inputResizeObserver = null;
    let sendCloseTimer = null;
    let resizeHandles = null;
    let resizeBadgeEl = null;
    let activeResize = null;

    function notifyEmotePickerOpened() {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('tcc:emote-picker-opened'));
      }
    }

    function handleRewardsOpened() {
      close();
    }

    function detectTwitchTheme() {
      const html = document.documentElement;
      if (html) {
        if (html.classList.contains('tw-root--theme-light') || html.getAttribute('data-a-theme') === 'light') {
          return 'light';
        }
        if (html.classList.contains('tw-root--theme-dark') || html.getAttribute('data-a-theme') === 'dark') {
          return 'dark';
        }
      }
      const probe = document.querySelector('.chat-shell, .right-column, body');
      if (probe) {
        try {
          const bg = getComputedStyle(probe).backgroundColor;
          const m = bg && bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
          if (m) {
            const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
            if (lum > 160) return 'light';
          }
        } catch (_) {}
      }
      return 'dark';
    }

    function applyTheme() {
      const next = detectTwitchTheme();
      if (next !== currentTheme && panelEl) {
        currentTheme = next;
        panelEl.setAttribute('data-theme', currentTheme);
        renderBody();
      } else if (panelEl) {
        currentTheme = next;
        panelEl.setAttribute('data-theme', currentTheme);
      }
    }

    function getAvatarColor(name) {
      const palette = ['#9147ff', '#00a8fc', '#e91916', '#00c7ac', '#ff7b00', '#d946ef', '#10b981'];
      let hash = 0;
      const str = String(name || '?');
      for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) | 0;
      }
      return palette[Math.abs(hash) % palette.length];
    }

    function getPickerCss() {
      return `
        :host {
          all: initial;
          font-family: "Inter", "Roobert", "Helvetica Neue", Helvetica, Arial, sans-serif;
        }
        * {
          box-sizing: border-box;
        }
        .tcc-panel {
          --bg: #18181b;
          --bg-elev: #1f1f23;
          --bg-hover: #2c2c34;
          --bg-input: #0e0e10;
          --border: #2f2f35;
          --text: #efeff1;
          --text-muted: #adadb8;
          --accent: #9147ff;
          --accent-hover: #772ce8;
          --star: #fbbf24;
          --shadow: 0 12px 32px rgba(0, 0, 0, 0.65);

          width: 38vw;
          height: 600px;
          background: var(--bg);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: var(--shadow);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
          font-size: 13px;
          user-select: none;
        }
        .tcc-panel[data-theme="light"] {
          --bg: #ffffff;
          --bg-elev: #f7f7f8;
          --bg-hover: #e9e9ee;
          --bg-input: #f2f2f5;
          --border: #dcdce2;
          --text: #0e0e10;
          --text-muted: #53535f;
          --shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
        }

        /* Header */
        .tcc-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: var(--bg-elev);
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .tcc-search-wrap {
          position: relative;
          flex: 1;
          display: flex;
          align-items: center;
        }
        .tcc-search-icon {
          position: absolute;
          left: 8px;
          width: 14px;
          height: 14px;
          color: var(--text-muted);
          pointer-events: none;
        }
        .tcc-search {
          width: 100%;
          height: 30px;
          padding: 0 24px 0 28px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg-input);
          color: var(--text);
          font-size: 12px;
          outline: none;
        }
        .tcc-search:focus {
          border-color: var(--accent);
        }
        .tcc-search-clear {
          position: absolute;
          right: 4px;
          width: 20px;
          height: 20px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: 4px;
          display: none;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          line-height: 1;
        }
        .tcc-search-clear.visible {
          display: flex;
        }
        .tcc-search-clear:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tcc-icon-btn {
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.12s, color 0.12s;
        }
        .tcc-icon-btn:hover, .tcc-icon-btn.active {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tcc-icon-btn.active {
          color: var(--accent);
        }
        .tcc-icon-btn.spinning svg {
          animation: tcc-spin 0.8s linear infinite;
        }
        @keyframes tcc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* Body Layout */
        .tcc-body {
          flex: 1;
          min-height: 0;
          display: flex;
          position: relative;
        }

        /* Right Channel Sidebar */
        .tcc-sidebar {
          width: 48px;
          flex-shrink: 0;
          background: var(--bg-elev);
          border-left: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 6px 0;
        }
        .tcc-nav-fav {
          width: 34px;
          height: 34px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: var(--star);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 17px;
          position: relative;
          flex-shrink: 0;
        }
        .tcc-nav-fav:hover, .tcc-nav-fav.active {
          background: var(--bg-hover);
        }
        .tcc-nav-fav.active::before, .tcc-nav-item.active::before {
          content: "";
          position: absolute;
          right: -7px;
          top: 6px;
          bottom: 6px;
          width: 3px;
          border-radius: 3px 0 0 3px;
          background: var(--accent);
        }
        .tcc-nav-sep {
          width: 26px;
          height: 1px;
          background: var(--border);
          margin: 5px 0;
          flex-shrink: 0;
        }
        .tcc-nav-list {
          flex: 1;
          min-height: 0;
          width: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 2px 0 8px;
          position: relative;
          scrollbar-width: none;
        }
        .tcc-nav-list::-webkit-scrollbar {
          display: none;
        }
        .tcc-nav-item {
          width: 34px;
          height: 34px;
          border: none;
          border-radius: 50%;
          background: transparent;
          padding: 2px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          flex-shrink: 0;
          transition: background 0.12s;
          touch-action: none;
        }
        .tcc-nav-item:hover {
          background: var(--bg-hover);
        }
        .tcc-nav-item.active {
          box-shadow: 0 0 0 2px var(--accent);
        }
        .tcc-nav-item.is-current-channel {
          cursor: pointer;
        }
        .tcc-nav-item.is-current-channel::after {
          content: "";
          position: absolute;
          right: 1px;
          bottom: 1px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent);
          border: 1.5px solid var(--bg-elev);
          pointer-events: none;
        }
        .tcc-nav-item.dragging-source {
          opacity: 0.3;
        }
        .tcc-nav-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
          pointer-events: none;
        }
        .tcc-nav-fallback {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          color: #fff;
          font-weight: 700;
          font-size: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .tcc-nav-globe {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--bg-hover);
          color: var(--text);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .tcc-nav-drop-line {
          position: absolute;
          left: 6px;
          right: 6px;
          height: 2px;
          background: var(--accent);
          border-radius: 2px;
          pointer-events: none;
          z-index: 10;
        }

        /* Main Scroll Area */
        .tcc-scroll-area {
          flex: 1;
          min-width: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 8px 10px 16px;
          scrollbar-width: thin;
          scrollbar-color: var(--border) transparent;
        }
        .tcc-scroll-area::-webkit-scrollbar {
          width: 6px;
        }
        .tcc-scroll-area::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 3px;
        }

        .tcc-section {
          margin-bottom: 12px;
        }
        .tcc-section-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 4px;
          border-radius: 5px;
          cursor: pointer;
          color: var(--text);
          font-weight: 600;
          font-size: 12px;
        }
        .tcc-section-header:hover {
          background: var(--bg-hover);
        }
        .tcc-section-header.static-header {
          cursor: default;
        }
        .tcc-section-header.static-header:hover {
          background: transparent;
        }
        .tcc-sec-avatar {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .tcc-sec-fallback {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .tcc-sec-title {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tcc-current-badge {
          font-size: 10px;
          font-weight: 600;
          color: #fff;
          background: var(--accent);
          border-radius: 999px;
          padding: 1px 6px;
          flex-shrink: 0;
        }
        .tcc-sec-count {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-muted);
        }
        .tcc-sec-chevron {
          font-size: 11px;
          color: var(--text-muted);
          width: 14px;
          text-align: center;
        }

        /* Emote Grid */
        .tcc-emote-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(var(--emote-cell, 40px), 1fr));
          gap: 3px;
          margin-top: 4px;
        }
        .tcc-emote-item {
          position: relative;
          height: var(--emote-cell, 40px);
          border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 3px;
          transition: background 0.1s, transform 0.08s;
          touch-action: none;
        }
        .tcc-emote-item:hover {
          background: var(--bg-hover);
        }
        .tcc-emote-item.flash {
          background: rgba(145, 71, 255, 0.3);
          transform: scale(0.92);
        }
        .tcc-emote-item.dragging-source {
          opacity: 0.28;
        }
        .tcc-emote-item.drop-before {
          box-shadow: inset 3px 0 0 var(--accent);
          background: rgba(145, 71, 255, 0.16);
        }
        .tcc-emote-item.drop-after {
          box-shadow: inset -3px 0 0 var(--accent);
          background: rgba(145, 71, 255, 0.16);
        }
        .tcc-emote-img {
          width: var(--emote-img, 32px);
          height: var(--emote-img, 32px);
          object-fit: contain;
          pointer-events: none;
        }

        /* Drag Ghost */
        .tcc-drag-ghost {
          position: fixed;
          z-index: 99999;
          pointer-events: none;
          opacity: 0.9;
          transform: translate(-50%, -50%) scale(1.12);
          background: var(--bg-elev);
          border: 1px solid var(--accent);
          border-radius: 8px;
          padding: 4px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Empty / Loading State */
        .tcc-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 28px 14px;
          gap: 10px;
          color: var(--text-muted);
        }
        .tcc-empty-title {
          color: var(--text);
          font-weight: 600;
          font-size: 13px;
        }
        .tcc-btn {
          border: none;
          border-radius: 6px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          background: var(--accent);
          color: #fff;
        }
        .tcc-btn:hover {
          background: var(--accent-hover);
        }
        .tcc-btn-secondary {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tcc-btn-secondary:hover {
          opacity: 0.9;
        }

        /* Panel Resize Handles */
        .tcc-resize-handle {
          position: absolute;
          z-index: 30;
          background: transparent;
          touch-action: none;
        }
        .tcc-resize-handle[hidden] {
          display: none;
        }
        .tcc-resize-n {
          top: 0;
          left: 10px;
          right: 10px;
          height: 6px;
          cursor: ns-resize;
        }
        .tcc-resize-w {
          left: 0;
          top: 10px;
          bottom: 0;
          width: 6px;
          cursor: ew-resize;
        }
        .tcc-resize-e {
          right: 0;
          top: 10px;
          bottom: 0;
          width: 6px;
          cursor: ew-resize;
        }
        .tcc-resize-nw {
          top: 0;
          left: 0;
          width: 12px;
          height: 12px;
          cursor: nwse-resize;
          z-index: 31;
        }
        .tcc-resize-ne {
          top: 0;
          right: 0;
          width: 12px;
          height: 12px;
          cursor: nesw-resize;
          z-index: 31;
        }
        .tcc-resize-n::after,
        .tcc-resize-w::after,
        .tcc-resize-e::after {
          content: "";
          position: absolute;
          background: transparent;
          transition: background 0.12s ease;
          pointer-events: none;
        }
        .tcc-resize-n::after {
          left: 0;
          right: 0;
          top: 1px;
          height: 2px;
        }
        .tcc-resize-w::after {
          top: 0;
          bottom: 0;
          left: 1px;
          width: 2px;
        }
        .tcc-resize-e::after {
          top: 0;
          bottom: 0;
          right: 1px;
          width: 2px;
        }
        .tcc-resize-n:hover::after,
        .tcc-resize-n.is-active::after,
        .tcc-resize-w:hover::after,
        .tcc-resize-w.is-active::after,
        .tcc-resize-e:hover::after,
        .tcc-resize-e.is-active::after {
          background: var(--accent);
        }
        .tcc-resize-nw::after,
        .tcc-resize-ne::after {
          content: "";
          position: absolute;
          width: 8px;
          height: 8px;
          border-color: transparent;
          border-style: solid;
          transition: border-color 0.12s ease;
          pointer-events: none;
        }
        .tcc-resize-nw::after {
          top: 2px;
          left: 2px;
          border-width: 2px 0 0 2px;
          border-top-left-radius: 3px;
        }
        .tcc-resize-ne::after {
          top: 2px;
          right: 2px;
          border-width: 2px 2px 0 0;
          border-top-right-radius: 3px;
        }
        .tcc-resize-nw:hover::after,
        .tcc-resize-nw.is-active::after,
        .tcc-resize-ne:hover::after,
        .tcc-resize-ne.is-active::after {
          border-color: var(--accent);
        }
        .tcc-resize-badge {
          display: none;
          position: absolute;
          top: 8px;
          left: 8px;
          z-index: 40;
          pointer-events: none;
          background: #18181b;
          color: #efeff1;
          border: 1px solid var(--accent);
          border-radius: 4px;
          padding: 2px 7px;
          font-size: 11px;
          font-weight: 600;
          line-height: 1.3;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
        }
        .tcc-panel.is-resizing .tcc-resize-badge {
          display: block;
        }
      `;
    }

    function ensureDom() {
      if (hostEl && hostEl.isConnected) return;
      if (!document.body) return;

      hostEl = document.createElement('div');
      hostEl.id = 'tcc-emote-picker-host';
      hostEl.dataset.resizeVersion = '2';
      hostEl.style.position = 'fixed';
      hostEl.style.zIndex = '2147483000';
      hostEl.style.display = 'none';

      shadowRoot = hostEl.attachShadow({ mode: 'open' });

      const styleEl = document.createElement('style');
      styleEl.textContent = getPickerCss();
      shadowRoot.appendChild(styleEl);

      panelEl = document.createElement('div');
      panelEl.className = 'tcc-panel';
      currentTheme = detectTwitchTheme();
      panelEl.setAttribute('data-theme', currentTheme);

      // Keep chat input focus when clicking non-input UI controls inside the picker
      panelEl.addEventListener('mousedown', (e) => {
        const tag = e.target && e.target.tagName ? e.target.tagName : '';
        if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'OPTION') {
          e.preventDefault();
        }
      });
      panelEl.addEventListener('dragstart', (e) => e.preventDefault());

      // Header
      const header = document.createElement('div');
      header.className = 'tcc-header';

      const searchWrap = document.createElement('div');
      searchWrap.className = 'tcc-search-wrap';
      searchWrap.innerHTML = `
        <svg class="tcc-search-icon" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
        </svg>
      `;
      searchInputEl = document.createElement('input');
      searchInputEl.type = 'text';
      searchInputEl.className = 'tcc-search';
      searchInputEl.placeholder = '検索...';
      searchInputEl.addEventListener('input', () => {
        searchQuery = searchInputEl.value;
        searchClearEl.classList.toggle('visible', searchQuery.length > 0);
        renderBody();
      });

      searchClearEl = document.createElement('button');
      searchClearEl.type = 'button';
      searchClearEl.className = 'tcc-search-clear';
      searchClearEl.textContent = '×';
      searchClearEl.title = 'クリア';
      searchClearEl.addEventListener('click', () => {
        searchQuery = '';
        searchInputEl.value = '';
        searchClearEl.classList.remove('visible');
        renderBody();
      });
      searchWrap.appendChild(searchInputEl);
      searchWrap.appendChild(searchClearEl);

      syncBtnEl = document.createElement('button');
      syncBtnEl.type = 'button';
      syncBtnEl.className = 'tcc-icon-btn';
      syncBtnEl.title = '再同期';
      syncBtnEl.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
        </svg>
      `;
      syncBtnEl.addEventListener('click', () => {
        triggerManualSync();
      });

      const nativeBtn = document.createElement('button');
      nativeBtn.type = 'button';
      nativeBtn.className = 'tcc-icon-btn';
      nativeBtn.title = 'Twitch標準';
      nativeBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-.464 5.535a1 1 0 10-1.415-1.414 3 3 0 01-4.242 0 1 1 0 00-1.415 1.414 5 5 0 007.072 0z" clip-rule="evenodd"/>
        </svg>
      `;
      nativeBtn.addEventListener('click', () => {
        openNativePickerTemporarily();
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tcc-icon-btn';
      closeBtn.title = '閉じる';
      closeBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      `;
      closeBtn.addEventListener('click', () => close());

      header.appendChild(searchWrap);
      header.appendChild(syncBtnEl);
      header.appendChild(nativeBtn);
      header.appendChild(closeBtn);
      panelEl.appendChild(header);

      // Body
      const body = document.createElement('div');
      body.className = 'tcc-body';

      const sidebar = document.createElement('div');
      sidebar.className = 'tcc-sidebar';

      navFavBtnEl = document.createElement('button');
      navFavBtnEl.type = 'button';
      navFavBtnEl.className = 'tcc-nav-fav active';
      navFavBtnEl.textContent = '★';
      navFavBtnEl.title = 'お気に入り';
      navFavBtnEl.addEventListener('click', () => jumpToSection('__favorites__'));

      const sep = document.createElement('div');
      sep.className = 'tcc-nav-sep';

      navListEl = document.createElement('div');
      navListEl.className = 'tcc-nav-list';

      sidebar.appendChild(navFavBtnEl);
      sidebar.appendChild(sep);
      sidebar.appendChild(navListEl);

      scrollAreaEl = document.createElement('div');
      scrollAreaEl.className = 'tcc-scroll-area';
      scrollAreaEl.addEventListener('scroll', handleScrollSpy, { passive: true });

      body.appendChild(scrollAreaEl);
      body.appendChild(sidebar);
      panelEl.appendChild(body);

      resizeBadgeEl = document.createElement('div');
      resizeBadgeEl.className = 'tcc-resize-badge';
      panelEl.appendChild(resizeBadgeEl);

      resizeHandles = {};
      ['n', 'w', 'e', 'nw', 'ne'].forEach((mode) => {
        const h = document.createElement('div');
        h.className = `tcc-resize-handle tcc-resize-${mode}`;
        h.dataset.resizeMode = mode;
        h.addEventListener('pointerdown', (e) => startPanelResize(mode, e));
        h.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          resetPanelSize(mode);
        });
        panelEl.appendChild(h);
        resizeHandles[mode] = h;
      });

      shadowRoot.appendChild(panelEl);
      document.body.appendChild(hostEl);
    }

    async function triggerManualSync() {
      if (isSyncing) return;
      isSyncing = true;
      if (syncBtnEl) syncBtnEl.classList.add('spinning');
      try {
        await onRequestSync();
      } finally {
        isSyncing = false;
        if (syncBtnEl) syncBtnEl.classList.remove('spinning');
      }
    }

    function openNativePickerTemporarily() {
      close();
      nativeOpenAtMouseDown = false;
      const btn =
        (lastAnchorButton && lastAnchorButton.isConnected && lastAnchorButton) ||
        document.querySelector('[data-a-target="emote-picker-button"]');
      if (btn) {
        bypassNativeClick = true;
        btn.click();
      }
    }

    function jumpToSection(sectionId) {
      if (!scrollAreaEl) return;
      activeNavId = sectionId;
      updateActiveNavHighlight();

      const target = scrollAreaEl.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`);
      if (target) {
        if (sectionScrollRaf !== null) cancelAnimationFrame(sectionScrollRaf);
        const area = scrollAreaEl;
        const startTop = area.scrollTop;
        const endTop = Math.max(0, Math.min(target.offsetTop - 4, area.scrollHeight - area.clientHeight));
        const startedAt = performance.now();
        function step(now) {
          const progress = Math.min(1, (now - startedAt) / 80);
          area.scrollTop = startTop + (endTop - startTop) * (1 - Math.pow(1 - progress, 3));
          sectionScrollRaf = progress < 1 ? requestAnimationFrame(step) : null;
        }
        sectionScrollRaf = requestAnimationFrame(step);
      }
    }

    function updateActiveNavHighlight() {
      if (navFavBtnEl) {
        navFavBtnEl.classList.toggle('active', activeNavId === '__favorites__');
      }
      if (navListEl) {
        const items = navListEl.querySelectorAll('.tcc-nav-item');
        for (let i = 0; i < items.length; i++) {
          items[i].classList.toggle('active', items[i].dataset.groupId === activeNavId);
        }
      }
    }

    function handleScrollSpy() {
      if (scrollSpyRaf || sectionScrollRaf !== null || !scrollAreaEl) return;
      scrollSpyRaf = true;
      requestAnimationFrame(() => {
        scrollSpyRaf = false;
        if (sectionScrollRaf !== null || !scrollAreaEl) return;
        const sections = scrollAreaEl.querySelectorAll('[data-section-id]');
        const scrollTop = scrollAreaEl.scrollTop + 28;
        let currentId = '__favorites__';
        for (let i = 0; i < sections.length; i++) {
          if (sections[i].offsetTop <= scrollTop) {
            currentId = sections[i].dataset.sectionId;
          } else {
            break;
          }
        }
        if (currentId !== activeNavId) {
          activeNavId = currentId;
          updateActiveNavHighlight();
        }
      });
    }

    function buildAvatarElement(group, imgClass, fallbackClass) {
      if (group.type === 'global') {
        const wrap = document.createElement('span');
        wrap.className = imgClass === 'tcc-nav-avatar' ? 'tcc-nav-globe' : 'tcc-sec-fallback';
        if (wrap.className === 'tcc-sec-fallback') {
          wrap.style.background = '#53535f';
        }
        wrap.innerHTML = `
          <svg width="${imgClass === 'tcc-nav-avatar' ? 16 : 12}" height="${imgClass === 'tcc-nav-avatar' ? 16 : 12}" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clip-rule="evenodd"/>
          </svg>
        `;
        return wrap;
      }

      const label = String(group.displayName || group.login || '?');
      const makeFallback = () => {
        const fb = document.createElement('span');
        fb.className = fallbackClass;
        fb.style.background = getAvatarColor(label);
        fb.textContent = label.slice(0, 1).toUpperCase();
        return fb;
      };

      if (group.avatarUrl) {
        const img = document.createElement('img');
        img.className = imgClass;
        img.src = group.avatarUrl;
        img.alt = label;
        img.draggable = false;
        img.loading = 'lazy';
        img.addEventListener('error', () => {
          const fb = makeFallback();
          if (img.parentNode) img.parentNode.replaceChild(fb, img);
        });
        return img;
      }
      return makeFallback();
    }

    function createEmoteButton(emote, ownerName, extraAttrs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tcc-emote-item';
      btn.title = emote.token;
      if (extraAttrs) {
        for (const k of Object.keys(extraAttrs)) {
          btn.setAttribute(k, extraAttrs[k]);
        }
      }

      const img = document.createElement('img');
      img.className = 'tcc-emote-img';
      img.src = getEmoteImageUrl(emote.id, currentTheme, '2.0');
      img.alt = emote.token;
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        if (!img.dataset.fallbackTried) {
          img.dataset.fallbackTried = '1';
          img.src = getEmoteImageUrl(emote.id, currentTheme, '1.0');
        }
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleToggleFavorite(emote, ownerName);
      });

      btn.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
          e.preventDefault();
        }
      });

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (suppressNextClick) {
          suppressNextClick = false;
          return;
        }
        if (!storage.canUseEmote(emote, currentChannel, state.catalog)) return;
        btn.classList.add('flash');
        setTimeout(() => btn.classList.remove('flash'), 140);

        const res = await onInsertEmote({
          token: emote.token,
          id: emote.id,
          setId: emote.setId || '',
          assetType: emote.assetType || 'STATIC'
        });
        if (res && res.ok !== false && !state.settings.picker.keepOpenOnSelect) {
          close();
        }
      });

      btn.appendChild(img);
      return btn;
    }

    async function handleToggleFavorite(emote, ownerName) {
      if (storage.channelOnlyId(emote, state.catalog)) return;
      const nextFavs = storage.toggleFavorite(state.favorites, emote, ownerName, state.catalog);
      state.favorites = nextFavs;
      renderBody();
      await onFavoritesChange(nextFavs);
    }

    // --- Pointer Events Drag & Drop: Channel Sidebar Vertical Reordering ---
    function attachNavDragHandler(itemEl, group, index, orderedGroups, pinnedGroupId) {
      if (pinnedGroupId && group.groupId === pinnedGroupId) return;

      itemEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || orderedGroups.length < 2) return;

        const minSlot = pinnedGroupId && orderedGroups[0]?.groupId === pinnedGroupId ? 1 : 0;
        const startY = e.clientY;
        const startX = e.clientX;
        let holdCancelled = false;
        let holdReady = false;
        let lastPointer = e;
        e.preventDefault?.();
        if (e.pointerId !== undefined) itemEl.setPointerCapture?.(e.pointerId);
        const holdTimer = setTimeout(() => {
          if (holdCancelled) return;
          holdReady = true;
          onMove(lastPointer);
        }, 450);
        let dragging = false;
        let ghost = null;
        let dropLine = null;
        let targetIndex = index;

        function computeDropIndex(clientY) {
          const items = Array.from(navListEl.querySelectorAll('.tcc-nav-item'));
          for (let i = minSlot; i < items.length; i++) {
            const rect = items[i].getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (clientY < mid) {
              return i;
            }
          }
          return items.length;
        }

        function updateIndicator(rawDropSlot) {
          const items = Array.from(navListEl.querySelectorAll('.tcc-nav-item'));
          const listRect = navListEl.getBoundingClientRect();
          let topPx = 0;
          if (rawDropSlot < items.length) {
            const r = items[rawDropSlot].getBoundingClientRect();
            topPx = r.top - listRect.top + navListEl.scrollTop - 2;
          } else if (items.length > 0) {
            const r = items[items.length - 1].getBoundingClientRect();
            topPx = r.bottom - listRect.top + navListEl.scrollTop + 1;
          }
          if (dropLine) {
            dropLine.style.top = `${Math.max(0, topPx)}px`;
          }
        }

        function onMove(ev) {
          lastPointer = ev;
          const dy = ev.clientY - startY;
          const dx = ev.clientX - startX;
          if (!dragging) {
            const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
            if (!holdReady) {
              if (distance > 8) { holdCancelled = true; clearTimeout(holdTimer); }
              return;
            }
            if (holdCancelled) return;
            dragging = true;
            suppressNextClick = true;
            itemEl.classList.add('dragging-source');

            ghost = document.createElement('div');
            ghost.className = 'tcc-drag-ghost';
            ghost.appendChild(buildAvatarElement(group, 'tcc-nav-avatar', 'tcc-nav-fallback'));
            shadowRoot.appendChild(ghost);

            dropLine = document.createElement('div');
            dropLine.className = 'tcc-nav-drop-line';
            navListEl.appendChild(dropLine);
          }

          if (ghost) {
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY}px`;
          }
          const rawSlot = Math.max(minSlot, computeDropIndex(ev.clientY));
          targetIndex = Math.max(minSlot, rawSlot > index ? rawSlot - 1 : rawSlot);
          updateIndicator(rawSlot);
        }

        function cleanup() {
          clearTimeout(holdTimer);
          if (e.pointerId !== undefined && itemEl.hasPointerCapture?.(e.pointerId)) itemEl.releasePointerCapture(e.pointerId);
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onEnd, true);
          window.removeEventListener('pointercancel', onEnd, true);
          itemEl.classList.remove('dragging-source');
          if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
          if (dropLine && dropLine.parentNode) dropLine.parentNode.removeChild(dropLine);
        }

        async function onEnd(ev) {
          cleanup();
          if (!dragging) return;
          if (ev && ev.type === 'pointercancel') {
            suppressNextClick = false;
            return;
          }
          // Clear click suppression shortly after pointerup
          setTimeout(() => {
            suppressNextClick = false;
          }, 50);

          if (targetIndex !== index && targetIndex >= minSlot && targetIndex < orderedGroups.length) {
            const currentIds = orderedGroups.map((g) => g.groupId);
            const nextOrder = storage.reorderGroupsWithPinned(
              currentIds,
              state.groupOrder,
              pinnedGroupId,
              index,
              targetIndex
            );
            state.groupOrder = nextOrder;
            renderBody();
            await onGroupOrderChange(nextOrder);
          }
        }

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onEnd, true);
        window.addEventListener('pointercancel', onEnd, true);
      });
    }

    // --- Pointer Events Drag & Drop: Favorites 2D Grid Reordering ---
    function attachFavoriteDragHandler(btnEl, fav, index, favGridEl, visible = state.favorites) {
      btnEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || searchQuery.trim() !== '' || visible.length < 2) return;

        const startX = e.clientX;
        const startY = e.clientY;
        let holdCancelled = false;
        let holdReady = false;
        let lastPointer = e;
        e.preventDefault?.();
        if (e.pointerId !== undefined) btnEl.setPointerCapture?.(e.pointerId);
        const holdTimer = setTimeout(() => {
          if (holdCancelled) return;
          holdReady = true;
          onMove(lastPointer);
        }, 450);
        let dragging = false;
        let ghost = null;
        let hoveredTargetIdx = index;
        let placeAfter = false;

        function clearDropClasses() {
          const cards = favGridEl.querySelectorAll('.tcc-emote-item');
          for (let i = 0; i < cards.length; i++) {
            cards[i].classList.remove('drop-before', 'drop-after');
          }
        }

        function updateTargetFromPoint(clientX, clientY) {
          clearDropClasses();
          const cards = Array.from(favGridEl.querySelectorAll('.tcc-emote-item[data-fav-index]'));
          let bestCard = null;
          let bestDist = Infinity;

          for (let i = 0; i < cards.length; i++) {
            const r = cards[i].getBoundingClientRect();
            const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
            if (inside) {
              bestCard = cards[i];
              break;
            }
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const d = Math.hypot(clientX - cx, clientY - cy);
            if (d < bestDist) {
              bestDist = d;
              bestCard = cards[i];
            }
          }

          if (!bestCard) return;
          const cardIdx = Number(bestCard.getAttribute('data-fav-index'));
          const rect = bestCard.getBoundingClientRect();
          placeAfter = clientX > rect.left + rect.width / 2;
          hoveredTargetIdx = cardIdx;
          if (cardIdx !== index) {
            bestCard.classList.add(placeAfter ? 'drop-after' : 'drop-before');
          }
        }

        function onMove(ev) {
          lastPointer = ev;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!dragging) {
            const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
            if (!holdReady) {
              if (distance > 8) { holdCancelled = true; clearTimeout(holdTimer); }
              return;
            }
            if (holdCancelled) return;
            dragging = true;
            suppressNextClick = true;
            btnEl.classList.add('dragging-source');

            ghost = document.createElement('div');
            ghost.className = 'tcc-drag-ghost';
            const img = document.createElement('img');
            img.src = getEmoteImageUrl(fav.id, currentTheme, '2.0');
            img.style.width = '32px';
            img.style.height = '32px';
            img.style.objectFit = 'contain';
            ghost.appendChild(img);
            shadowRoot.appendChild(ghost);
          }

          if (ghost) {
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY}px`;
          }
          updateTargetFromPoint(ev.clientX, ev.clientY);
        }

        function cleanup() {
          clearTimeout(holdTimer);
          if (e.pointerId !== undefined && btnEl.hasPointerCapture?.(e.pointerId)) btnEl.releasePointerCapture(e.pointerId);
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onEnd, true);
          window.removeEventListener('pointercancel', onEnd, true);
          btnEl.classList.remove('dragging-source');
          clearDropClasses();
          if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        }

        async function onEnd(ev) {
          cleanup();
          if (!dragging) return;
          if (ev && ev.type === 'pointercancel') {
            suppressNextClick = false;
            return;
          }
          setTimeout(() => {
            suppressNextClick = false;
          }, 50);

          let toIdx = hoveredTargetIdx;
          if (placeAfter && toIdx < index) toIdx += 1;
          if (!placeAfter && toIdx > index) toIdx -= 1;
          toIdx = Math.max(0, Math.min(visible.length - 1, toIdx));

          if (toIdx !== index) {
            const nextFavs = storage.reorderVisibleFavorites(state.favorites, visible, index, toIdx);
            state.favorites = nextFavs;
            renderBody();
            await onFavoritesChange(nextFavs);
          }
        }

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onEnd, true);
        window.addEventListener('pointercancel', onEnd, true);
      });
    }

    function renderBody() {
      if (!navListEl || !scrollAreaEl || !panelEl) return;

      const prevScrollTop = scrollAreaEl.scrollTop;
      const emotePx = EMOTE_SIZE_PX[state.settings.picker.emoteSize] || EMOTE_SIZE_PX.medium;
      panelEl.style.setProperty('--emote-img', `${emotePx}px`);
      panelEl.style.setProperty('--emote-cell', `${emotePx + 8}px`);

      const pinEnabled = state.settings.picker.pinCurrentChannel !== false;
      const pinnedGroupId = pinEnabled
        ? storage.findCurrentChannelGroupId(state.catalog && state.catalog.groups, currentChannel)
        : null;
      const orderedGroups = storage.computeOrderedGroups(
        state.catalog && state.catalog.groups,
        state.groupOrder,
        { currentChannel, pinCurrentChannel: pinEnabled, catalog: state.catalog }
      );
      const collapsedSet = new Set(state.collapsedGroups || []);
      const query = searchQuery.trim().toLowerCase();

      // Render left channel sidebar
      navListEl.innerHTML = '';
      for (let i = 0; i < orderedGroups.length; i++) {
        const g = orderedGroups[i];
        const isPinned = Boolean(pinnedGroupId && g.groupId === pinnedGroupId);
        const navBtn = document.createElement('button');
        navBtn.type = 'button';
        navBtn.className =
          'tcc-nav-item' +
          (activeNavId === g.groupId ? ' active' : '') +
          (isPinned ? ' is-current-channel' : '');
        navBtn.dataset.groupId = g.groupId;
        navBtn.title = g.displayName || g.login || g.groupId;
        navBtn.appendChild(buildAvatarElement(g, 'tcc-nav-avatar', 'tcc-nav-fallback'));

        navBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (suppressNextClick) {
            suppressNextClick = false;
            return;
          }
          jumpToSection(g.groupId);
        });

        attachNavDragHandler(navBtn, g, i, orderedGroups, pinnedGroupId);
        navListEl.appendChild(navBtn);
      }

      // Render right scroll sections
      scrollAreaEl.innerHTML = '';

      if (orderedGroups.length === 0 && state.favorites.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tcc-empty-state';
        empty.innerHTML = `
          <div class="tcc-empty-title">${isSyncing ? '取得中...' : 'スタンプがありません'}</div>
        `;
        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '8px';
        btnRow.style.flexWrap = 'wrap';
        btnRow.style.justifyContent = 'center';

        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'tcc-btn';
        retryBtn.textContent = '再同期';
        retryBtn.addEventListener('click', () => triggerManualSync());

        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'tcc-btn tcc-btn-secondary';
        importBtn.textContent = '標準から取り込む';
        importBtn.addEventListener('click', () => openNativePickerTemporarily());

        btnRow.appendChild(retryBtn);
        btnRow.appendChild(importBtn);
        empty.appendChild(btnRow);
        scrollAreaEl.appendChild(empty);
        return;
      }

      // 1. Favorites Section
      const usableFavorites = storage.visibleFavorites(state.favorites, state.catalog, currentChannel);
      const filteredFavorites = query
        ? usableFavorites.filter(
            (f) =>
              f.token.toLowerCase().includes(query) ||
              String(f.ownerName || '').toLowerCase().includes(query)
          )
        : usableFavorites;

      if (!query || filteredFavorites.length > 0) {
        const favSec = document.createElement('div');
        favSec.className = 'tcc-section';
        favSec.setAttribute('data-section-id', '__favorites__');

        const favHead = document.createElement('div');
        favHead.className = 'tcc-section-header static-header';
        favHead.innerHTML = `
          <span style="color:var(--star);font-size:14px;">★</span>
          <span class="tcc-sec-title">お気に入り</span>
          <span class="tcc-sec-count">${filteredFavorites.length}</span>
        `;
        favSec.appendChild(favHead);

        if (filteredFavorites.length > 0) {
          const grid = document.createElement('div');
          grid.className = 'tcc-emote-grid';
          for (let i = 0; i < filteredFavorites.length; i++) {
            const fav = filteredFavorites[i];
            const btn = createEmoteButton(fav, fav.ownerName || 'お気に入り', {
              'data-fav-index': String(i)
            });
            if (!query) {
              attachFavoriteDragHandler(btn, fav, i, grid, usableFavorites);
            }
            grid.appendChild(btn);
          }
          favSec.appendChild(grid);
        }
        scrollAreaEl.appendChild(favSec);
      }

      // 2. Channel & Global Sections
      let matchedAnyGroup = false;
      for (let i = 0; i < orderedGroups.length; i++) {
        const g = orderedGroups[i];
        const groupMatches = query && String(g.displayName || g.login || '').toLowerCase().includes(query);
        const emotesToShow = query && !groupMatches
          ? g.emotes.filter((e) => e.token.toLowerCase().includes(query))
          : g.emotes;

        if (query && emotesToShow.length === 0) continue;
        matchedAnyGroup = true;

        const isCollapsed = !query && collapsedSet.has(g.groupId);
        const sec = document.createElement('div');
        sec.className = 'tcc-section';
        sec.setAttribute('data-section-id', g.groupId);

        const head = document.createElement('div');
        head.className = 'tcc-section-header';
        head.appendChild(buildAvatarElement(g, 'tcc-sec-avatar', 'tcc-sec-fallback'));

        const title = document.createElement('span');
        title.className = 'tcc-sec-title';
        title.textContent = g.displayName || g.login || g.groupId;

        const count = document.createElement('span');
        count.className = 'tcc-sec-count';
        count.textContent = String(emotesToShow.length);

        const chev = document.createElement('span');
        chev.className = 'tcc-sec-chevron';
        chev.textContent = isCollapsed ? '▸' : '▾';

        head.appendChild(title);
        if (pinnedGroupId && g.groupId === pinnedGroupId) {
          const currBadge = document.createElement('span');
          currBadge.className = 'tcc-current-badge';
          currBadge.textContent = 'このチャンネル';
          head.appendChild(currBadge);
        }
        head.appendChild(count);
        head.appendChild(chev);
        head.addEventListener('click', () => {
          if (query) return;
          const nextCollapsed = new Set(state.collapsedGroups || []);
          if (nextCollapsed.has(g.groupId)) {
            nextCollapsed.delete(g.groupId);
          } else {
            nextCollapsed.add(g.groupId);
          }
          const arr = Array.from(nextCollapsed);
          state.collapsedGroups = arr;
          renderBody();
          onCollapsedChange(arr);
        });
        sec.appendChild(head);

        if (!isCollapsed) {
          const grid = document.createElement('div');
          grid.className = 'tcc-emote-grid';
          for (let j = 0; j < emotesToShow.length; j++) {
            const em = emotesToShow[j];
            const enrichedEmote = {
              ...em,
              id: em.id,
              token: em.token,
              assetType: em.assetType,
              groupId: g.groupId
            };
            const btn = createEmoteButton(enrichedEmote, g.displayName || g.login);
            grid.appendChild(btn);
          }
          sec.appendChild(grid);
        }

        scrollAreaEl.appendChild(sec);
      }

      if (query && !matchedAnyGroup && filteredFavorites.length === 0) {
        const noRes = document.createElement('div');
        noRes.className = 'tcc-empty-state';
        const noResTitle = document.createElement('div');
        noResTitle.className = 'tcc-empty-title';
        noResTitle.textContent = `「${searchQuery}」に一致するスタンプがありません`;
        noRes.appendChild(noResTitle);
        scrollAreaEl.appendChild(noRes);
      }

      scrollAreaEl.scrollTop = prevScrollTop;
      updateActiveNavHighlight();
    }

    function findChatInputTop(anchor) {
      const anchorRect = anchor.getBoundingClientRect();
      let bestTop = anchorRect.top;
      const candidates = [
        anchor.closest && anchor.closest('.chat-input__textarea'),
        anchor.closest && anchor.closest('.chat-wysiwyg-input-box'),
        anchor.closest && anchor.closest('.chat-wysiwyg-input__box'),
        anchor.closest && anchor.closest('.chat-input'),
        document.querySelector('[data-slate-editor="true"]')?.parentElement,
        document.querySelector('[data-slate-editor="true"]'),
        anchor
      ];
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (!el || !el.getBoundingClientRect) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const diff = anchorRect.top - r.top;
        if (diff >= 0 && diff <= 240 && r.top < bestTop) {
          bestTop = r.top;
        }
      }
      return bestTop;
    }

    function positionPanel(anchorEl) {
      if (!hostEl || !panelEl) return;

      const desiredH = clampPickerHeight(state.settings?.picker?.pickerHeightPx);
      const panelW = resolvePickerWidthPx(state.settings?.picker, window.innerWidth);

      const anchor =
        (anchorEl && anchorEl.isConnected && anchorEl) ||
        (lastAnchorButton && lastAnchorButton.isConnected && lastAnchorButton) ||
        document.querySelector('[data-a-target="emote-picker-button"]') ||
        document.querySelector('.chat-input');

      if (!anchor) {
        const panelH = Math.min(desiredH, Math.max(260, window.innerHeight - 24));
        panelEl.style.width = `${panelW}px`;
        panelEl.style.height = `${panelH}px`;
        const freeLeft = Math.max(8, window.innerWidth - panelW - 12);
        hostEl.style.left = `${freeLeft}px`;
        hostEl.style.top = `${Math.max(8, window.innerHeight - panelH - 72)}px`;
        syncPanelResizeHandles(freeLeft, panelW);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const inputTop = findChatInputTop(anchor);
      const spaceAbove = inputTop - 16;

      let panelH;
      let top;
      if (spaceAbove >= 220) {
        panelH = Math.min(desiredH, spaceAbove);
        top = inputTop - panelH - 8;
      } else {
        const spaceBelow = window.innerHeight - rect.bottom - 16;
        panelH = Math.min(desiredH, Math.max(220, spaceBelow));
        top = Math.min(window.innerHeight - panelH - 8, rect.bottom + 8);
      }
      top = Math.max(8, top);

      panelEl.style.width = `${panelW}px`;
      panelEl.style.height = `${Math.round(panelH)}px`;

      const chatContainer =
        (anchor.closest &&
          anchor.closest('.chat-input, .chat-shell, .stream-chat, .channel-root__right-column, .right-column')) ||
        anchor;
      const chatRect = chatContainer.getBoundingClientRect();
      const rawRight = chatRect.width > 0 ? chatRect.right - 8 : window.innerWidth - 8;
      const rightEdge = Math.min(window.innerWidth - 8, rawRight);
      let left = rightEdge - panelW;
      left = Math.max(8, Math.min(window.innerWidth - panelW - 8, left));

      hostEl.style.left = `${Math.round(left)}px`;
      hostEl.style.top = `${Math.round(top)}px`;
      syncPanelResizeHandles(left, panelW);
    }

    function syncPanelResizeHandles(left, panelW) {
      if (!resizeHandles || activeResize) return;
      const isLeftClamped = left <= 12 && (left + panelW) < window.innerWidth - 12;
      if (resizeHandles.w) resizeHandles.w.hidden = isLeftClamped;
      if (resizeHandles.nw) resizeHandles.nw.hidden = isLeftClamped;
      if (resizeHandles.e) resizeHandles.e.hidden = !isLeftClamped;
      if (resizeHandles.ne) resizeHandles.ne.hidden = !isLeftClamped;
      if (resizeHandles.n) resizeHandles.n.hidden = false;
    }

    function cursorClassForMode(mode) {
      if (mode === 'n') return 'tcc-picker-resizing-ns';
      if (mode === 'w' || mode === 'e') return 'tcc-picker-resizing-ew';
      if (mode === 'nw') return 'tcc-picker-resizing-nwse';
      return 'tcc-picker-resizing-nesw';
    }

    function endPanelResize(commit) {
      if (!activeResize) return;
      const session = activeResize;
      activeResize = null;
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointermove', session.onMove, true);
        window.removeEventListener('pointerup', session.onUp, true);
        window.removeEventListener('pointercancel', session.onCancel, true);
        window.removeEventListener('mousemove', session.onMove, true);
        window.removeEventListener('mouseup', session.onUp, true);
      }
      if (document.documentElement && document.documentElement.classList) {
        document.documentElement.classList.remove(session.cursorClass);
      }
      if (panelEl) panelEl.classList.remove('is-resizing');
      if (session.handle && session.handle.classList) session.handle.classList.remove('is-active');
      if (session.handle && typeof session.handle.releasePointerCapture === 'function' && session.pointerId !== undefined) {
        try { session.handle.releasePointerCapture(session.pointerId); } catch (_) {}
      }
      if (!commit) {
        state = Object.assign({}, state, { settings: Object.assign({}, state.settings, { picker: session.originalPicker }) });
        if (isOpen) positionPanel(lastAnchorButton);
        return;
      }
      if (isOpen) positionPanel(lastAnchorButton);
      if (session.isPct) {
        if (session.curPct !== session.origPct || session.curH !== session.origH) {
          onSizeCommit({
            pickerWidthPct: clampPickerWidthPct(session.curPct),
            pickerHeightPx: clampPickerHeight(session.curH)
          });
        }
      } else if (session.curW !== session.origW || session.curH !== session.origH) {
        onSizeCommit({
          pickerWidthPx: clampPickerWidthPx(session.curW),
          pickerHeightPx: clampPickerHeight(session.curH)
        });
      }
    }

    function resetPanelSize(mode) {
      const prevPicker = (state.settings && state.settings.picker) || DEFAULT_SETTINGS.picker;
      const isPct = normalizeWidthUnit(prevPicker.pickerWidthUnit) === '%';
      const origH = clampPickerHeight(prevPicker.pickerHeightPx);
      const nextH = mode.includes('n') ? DEFAULT_SETTINGS.picker.pickerHeightPx : origH;
      const hasHoriz = mode.includes('w') || mode.includes('e');
      if (isPct) {
        const origPct = clampPickerWidthPct(prevPicker.pickerWidthPct);
        const nextPct = hasHoriz ? DEFAULT_SETTINGS.picker.pickerWidthPct : origPct;
        if (nextPct === origPct && nextH === origH) return;
        state = Object.assign({}, state, {
          settings: Object.assign({}, state.settings, {
            picker: Object.assign({}, prevPicker, { pickerWidthPct: nextPct, pickerHeightPx: nextH })
          })
        });
        if (isOpen) positionPanel(lastAnchorButton);
        onSizeCommit({ pickerWidthPct: nextPct, pickerHeightPx: nextH });
        return;
      }
      const origW = clampPickerWidthPx(prevPicker.pickerWidthPx);
      const nextW = hasHoriz ? DEFAULT_SETTINGS.picker.pickerWidthPx : origW;
      if (nextW === origW && nextH === origH) return;
      state = Object.assign({}, state, {
        settings: Object.assign({}, state.settings, {
          picker: Object.assign({}, prevPicker, { pickerWidthPx: nextW, pickerHeightPx: nextH })
        })
      });
      if (isOpen) positionPanel(lastAnchorButton);
      onSizeCommit({ pickerWidthPx: nextW, pickerHeightPx: nextH });
    }

    function updateResizeBadge() {
      if (!panelEl || !resizeBadgeEl) return;
      const rect = panelEl.getBoundingClientRect();
      const width = Math.round(rect.width || parseFloat(panelEl.style.width) || 0);
      const height = Math.round(rect.height || parseFloat(panelEl.style.height) || 0);
      resizeBadgeEl.textContent = `幅 ${width}px × 高さ ${height}px`;
    }

    function startPanelResize(mode, e) {
      if (!panelEl || e.button !== 0) return;
      endPanelResize(false);
      e.preventDefault();
      e.stopPropagation();

      const prevPicker = (state.settings && state.settings.picker) || DEFAULT_SETTINGS.picker;
      const isPct = normalizeWidthUnit(prevPicker.pickerWidthUnit) === '%';
      const rect = panelEl.getBoundingClientRect ? panelEl.getBoundingClientRect() : {};
      const styleW = parseFloat(panelEl.style && panelEl.style.width);
      const styleH = parseFloat(panelEl.style && panelEl.style.height);
      const origW = clampPickerWidthPx(prevPicker.pickerWidthPx);
      const origPct = clampPickerWidthPct(prevPicker.pickerWidthPct);
      const origH = clampPickerHeight(prevPicker.pickerHeightPx);
      const startW = styleW > 0 ? styleW : (rect.width > 0 ? rect.width : resolvePickerWidthPx(prevPicker, window.innerWidth));
      const startH = styleH > 0 ? styleH : (rect.height > 0 ? rect.height : origH);
      const startPct = isPct ? clampPickerWidthPct((startW / Math.max(1, window.innerWidth) * 100)) : origPct;
      const startX = e.clientX;
      const startY = e.clientY;
      const cursorClass = cursorClassForMode(mode);
      const handle = resizeHandles && resizeHandles[mode];

      const session = {
        handle,
        pointerId: e.pointerId,
        originalPicker: prevPicker,
        cursorClass,
        isPct,
        origW,
        origPct,
        origH,
        curW: clampPickerWidthPx(startW),
        curPct: startPct,
        curH: startH,
        onMove(ev) {
          if (session.pointerId !== undefined && ev.pointerId !== undefined && ev.pointerId !== session.pointerId) return;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const rawW = mode.includes('w') ? startW - dx : mode.includes('e') ? startW + dx : startW;
          const nextH = mode.includes('n') ? clampPickerHeight(startH - dy) : session.curH;
          const curPicker = (state.settings && state.settings.picker) || DEFAULT_SETTINGS.picker;
          if (isPct) {
            const nextPct = mode.includes('w') || mode.includes('e')
              ? clampPickerWidthPct((rawW / Math.max(1, window.innerWidth) * 100))
              : session.curPct;
            state = Object.assign({}, state, {
              settings: Object.assign({}, state.settings, {
                picker: Object.assign({}, curPicker, { pickerWidthPct: nextPct, pickerHeightPx: nextH })
              })
            });
            positionPanel(lastAnchorButton);
            const appliedH = Math.round(parseFloat(panelEl.style.height) || nextH);
            session.curPct = nextPct;
            session.curH = clampPickerHeight(appliedH);
            updateResizeBadge();
          } else {
            const nextW = mode.includes('w') || mode.includes('e')
              ? clampPickerWidthPx(rawW)
              : session.curW;
            state = Object.assign({}, state, {
              settings: Object.assign({}, state.settings, {
                picker: Object.assign({}, curPicker, { pickerWidthPx: nextW, pickerHeightPx: nextH })
              })
            });
            positionPanel(lastAnchorButton);
            const appliedW = Math.round(parseFloat(panelEl.style.width) || nextW);
            const appliedH = Math.round(parseFloat(panelEl.style.height) || nextH);
            session.curW = clampPickerWidthPx(appliedW);
            session.curH = clampPickerHeight(appliedH);
            updateResizeBadge();
          }
        },
        onUp(ev) {
          if (session.pointerId !== undefined && ev.pointerId !== undefined && ev.pointerId !== session.pointerId) return;
          endPanelResize(true);
        },
        onCancel(ev) {
          if (session.pointerId !== undefined && ev.pointerId !== undefined && ev.pointerId !== session.pointerId) return;
          endPanelResize(false);
        }
      };

      updateResizeBadge();

      activeResize = session;
      if (handle && typeof handle.setPointerCapture === 'function' && e.pointerId !== undefined) {
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      }
      if (document.documentElement && document.documentElement.classList) {
        document.documentElement.classList.add(cursorClass);
      }
      panelEl.classList.add('is-resizing');
      if (handle && handle.classList) handle.classList.add('is-active');

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pointermove', session.onMove, true);
        window.addEventListener('pointerup', session.onUp, true);
        window.addEventListener('pointercancel', session.onCancel, true);
        window.addEventListener('mousemove', session.onMove, true);
        window.addEventListener('mouseup', session.onUp, true);
      }
    }

    function observeInputBox(anchorEl) {
      if (inputResizeObserver) {
        inputResizeObserver.disconnect();
        inputResizeObserver = null;
      }
      if (typeof ResizeObserver === 'undefined') return;
      const anchor =
        (anchorEl && anchorEl.isConnected && anchorEl) ||
        (lastAnchorButton && lastAnchorButton.isConnected && lastAnchorButton) ||
        document.querySelector('[data-a-target="emote-picker-button"]');
      const target =
        (anchor && anchor.closest && anchor.closest('.chat-input')) ||
        document.querySelector('.chat-input') ||
        (anchor && anchor.parentElement);
      if (!target) return;
      inputResizeObserver = new ResizeObserver(() => {
        if (isOpen) positionPanel(lastAnchorButton);
      });
      inputResizeObserver.observe(target);
    }

    function open(anchorEl) {
      if (!state.settings.enabled || state.settings.picker.enabled === false) return;
      ensureDom();
      if (!hostEl) return;
      if (anchorEl) lastAnchorButton = anchorEl;
      isOpen = true;
      notifyEmotePickerOpened();
      applyTheme();
      renderBody();
      hostEl.style.display = 'block';
      positionPanel(anchorEl);
      observeInputBox(anchorEl);

      // Refresh viewer permissions after a minute, including subscription expiry/renewal.
      const hasGroups = state.catalog && state.catalog.groups && Object.keys(state.catalog.groups).length > 0;
      const stalePermissions = !state.catalog.permissionsUpdatedAt || Date.now() - state.catalog.permissionsUpdatedAt > 60000;
      if ((!hasGroups || stalePermissions) && !isSyncing) {
        triggerManualSync();
      }
    }

    function close() {
      endPanelResize(false);
      if (sectionScrollRaf !== null) cancelAnimationFrame(sectionScrollRaf);
      sectionScrollRaf = null;
      clearTimeout(sendCloseTimer);
      sendCloseTimer = null;
      if (inputResizeObserver) {
        inputResizeObserver.disconnect();
        inputResizeObserver = null;
      }
      if (!isOpen) return;
      isOpen = false;
      if (hostEl) hostEl.style.display = 'none';
    }

    function toggle(anchorEl) {
      if (isOpen) {
        close();
      } else {
        open(anchorEl);
      }
    }

    function isNativeEmotePickerOpen(btn) {
      if (btn) {
        if (btn.getAttribute('aria-expanded') === 'true' || btn.getAttribute('aria-pressed') === 'true') {
          return true;
        }
      }
      const selectors = [
        '[data-a-target="emote-picker"]',
        '[data-test-selector="emote-picker"]',
        '.emote-picker',
        '[data-a-target="emote-picker-search-input"]',
        '[data-a-target="emote-picker-tab-nav"]',
        '[data-test-selector="emote-picker-scroll-container"]',
        '.emote-picker__nav-content',
        '.emote-picker__tab-content'
      ];
      for (let i = 0; i < selectors.length; i++) {
        const candidates = document.querySelectorAll(selectors[i]);
        for (let j = 0; j < candidates.length; j++) {
          const el = candidates[j];
          if (!el || (hostEl && hostEl.contains(el))) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return true;
          }
        }
      }
      return false;
    }

    function closeAfterSend(input) {
      if (!isOpen || !input) return;
      const hasDraft = () => {
        const text = typeof input.value === 'string' ? input.value : input.textContent || '';
        return Boolean(text.replace(/[\u200B\uFEFF]/g, '').trim() || input.querySelector('img'));
      };
      if (!hasDraft()) return;
      clearTimeout(sendCloseTimer);
      // Let Twitch process the event. Failed sends, IME confirmation and
      // autocomplete leave the draft intact, so the picker stays open.
      sendCloseTimer = setTimeout(() => {
        sendCloseTimer = null;
        if (isOpen && input.isConnected && !hasDraft()) close();
      }, 150);
    }

    function handleDocumentClick(e) {
      const sendButton = e.target && e.target.closest
        ? e.target.closest('[data-a-target="chat-send-button"]') : null;
      if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
        const scope = sendButton.closest('.chat-input') || document;
        closeAfterSend(scope.querySelector(
          'textarea[data-a-target="chat-input"], [data-slate-editor="true"], [contenteditable="true"][data-a-target="chat-input"]'
        ));
      }
      const btn =
        e.target && e.target.closest
          ? e.target.closest('[data-a-target="emote-picker-button"]')
          : null;
      if (!btn) return;

      if (bypassNativeClick) {
        bypassNativeClick = false;
        nativeOpenAtMouseDown = false;
        return;
      }

      const s = state.settings;
      if (!s || !s.enabled || !s.picker || s.picker.enabled === false || e.shiftKey) {
        nativeOpenAtMouseDown = false;
        close();
        return;
      }

      const wasOpenAtDown = nativeOpenAtMouseDown;
      nativeOpenAtMouseDown = false;
      const openAtClick = isNativeEmotePickerOpen(btn);

      if (openAtClick) {
        close();
        return;
      }

      if (wasOpenAtDown) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        close();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggle(btn);
    }

    function handleDocumentMouseDown(e) {
      const mousedownBtn =
        e.target && e.target.closest
          ? e.target.closest('[data-a-target="emote-picker-button"]')
          : null;
      if (mousedownBtn) {
        nativeOpenAtMouseDown = isNativeEmotePickerOpen(mousedownBtn);
      } else {
        nativeOpenAtMouseDown = false;
      }

      if (!isOpen) return;
      const rewardsTarget =
        e.target && e.target.closest
          ? e.target.closest(`${REWARDS_TRIGGER_SELECTOR}, .reward-center__content, .tcc-rewards-snapshot`)
          : null;
      if (rewardsTarget && (!hostEl || !hostEl.contains(rewardsTarget))) {
        close();
        return;
      }
      const path = e.composedPath ? e.composedPath() : [];
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (!node || node === window || node === document) continue;
        if (node === hostEl) return;
        if (
          node.matches &&
          node.matches(
            '.chat-input, [data-slate-editor="true"], [data-a-target="chat-input"], [data-a-target="chat-send-button"], [data-a-target="emote-picker-button"]'
          )
        ) {
          return;
        }
      }
      close();
    }

    function handleDocumentKeyDown(e) {
      if (isOpen && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
          !e.isComposing && e.keyCode !== 229) {
        const input = e.target && e.target.closest ? e.target.closest(
          'textarea[data-a-target="chat-input"], [data-slate-editor="true"], [contenteditable="true"][data-a-target="chat-input"]'
        ) : null;
        closeAfterSend(input);
      }
      if (isOpen && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }

    function handleWindowResize() {
      if (isOpen) positionPanel(lastAnchorButton);
    }

    function updateState(nextState, options = {}) {
      if (!nextState) return;
      const incomingSettings = nextState.settings || state.settings;
      const settings = activeResize
        ? Object.assign({}, incomingSettings, { picker: Object.assign({}, incomingSettings.picker, {
            pickerWidthPx: state.settings.picker.pickerWidthPx,
            pickerWidthPct: state.settings.picker.pickerWidthPct,
            pickerHeightPx: state.settings.picker.pickerHeightPx,
            pickerWidthUnit: state.settings.picker.pickerWidthUnit
          }) })
        : incomingSettings;
      state = {
        settings,
        catalog: nextState.catalog || state.catalog,
        favorites: storage.filterFavorites(Array.isArray(nextState.favorites) ? nextState.favorites : state.favorites, nextState.catalog || state.catalog),
        groupOrder: Array.isArray(nextState.groupOrder) ? nextState.groupOrder : state.groupOrder,
        collapsedGroups: Array.isArray(nextState.collapsedGroups)
          ? nextState.collapsedGroups
          : state.collapsedGroups
      };

      if (state.settings && (!state.settings.enabled || state.settings.picker.enabled === false) && isOpen) {
        close();
      }
      if (isOpen) {
        if (!options || options.layoutOnly !== true) {
          renderBody();
        }
        positionPanel(lastAnchorButton);
      }
    }

    function init(initialState) {
      updateState(initialState);
      document.addEventListener('click', handleDocumentClick, true);
      document.addEventListener('mousedown', handleDocumentMouseDown, true);
      document.addEventListener('keydown', handleDocumentKeyDown, true);
      window.addEventListener('resize', handleWindowResize, { passive: true });
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('tcc:rewards-opened', handleRewardsOpened);
      }

      if (document.documentElement && !themeObserver) {
        themeObserver = new MutationObserver(() => {
          if (isOpen) applyTheme();
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-a-theme']
        });
      }
    }

    function destroy() {
      endPanelResize(false);
      if (sectionScrollRaf !== null) cancelAnimationFrame(sectionScrollRaf);
      sectionScrollRaf = null;
      clearTimeout(sendCloseTimer);
      sendCloseTimer = null;
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
      window.removeEventListener('resize', handleWindowResize);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('tcc:rewards-opened', handleRewardsOpened);
      }
      if (themeObserver) {
        themeObserver.disconnect();
        themeObserver = null;
      }
      if (inputResizeObserver) {
        inputResizeObserver.disconnect();
        inputResizeObserver = null;
      }
      if (hostEl && hostEl.parentNode) {
        hostEl.parentNode.removeChild(hostEl);
        hostEl = null;
      }
    }

    function setCurrentChannel(channelInfo) {
      const nextId = channelInfo && channelInfo.id ? String(channelInfo.id).trim() : '';
      const nextLogin =
        channelInfo && typeof channelInfo.login === 'string'
          ? channelInfo.login.trim().toLowerCase()
          : '';
      if (currentChannel.id === nextId && currentChannel.login === nextLogin) return;
      currentChannel = { id: nextId, login: nextLogin };
      if (isOpen) {
        renderBody();
      }
    }

    return {
      init,
      updateState,
      setCurrentChannel,
      open,
      close,
      toggle,
      isOpen: () => isOpen,
      destroy
    };
  }

  root.TCC.createEmotePickerManager = createEmotePickerManager;
})(typeof globalThis !== 'undefined' ? globalThis : this);
