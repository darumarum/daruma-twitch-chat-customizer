(function () {
  'use strict';

  const { constants, storage } = globalThis.TCC || {};
  if (!constants || !storage) return;

  const { DEFAULT_SETTINGS, STORAGE_KEYS, deepMergeSettings, getEmoteImageUrl } = constants;

  let state = {
    settings: DEFAULT_SETTINGS,
    catalog: { groups: {}, updatedAt: 0 },
    favorites: [],
    groupOrder: [],
    collapsedGroups: []
  };

  let activeTab = 'favorites';
  let favSearch = '';
  let browseSearch = '';
  let browseChannelFilter = '';
  let browseOnlyFav = false;
  let undoStack = [];
  let toastTimer = null;

  const els = {
    extVersion: document.getElementById('ext-version'),
    statFavorites: document.getElementById('stat-favorites'),
    statGroups: document.getElementById('stat-groups'),
    statEmotes: document.getElementById('stat-emotes'),
    btnUndo: document.getElementById('btn-undo'),
    sizeBtns: Array.from(document.querySelectorAll('.size-btn')),
    tabBtns: Array.from(document.querySelectorAll('.tab-btn')),
    panels: {
      favorites: document.getElementById('panel-favorites'),
      channels: document.getElementById('panel-channels'),
      browse: document.getElementById('panel-browse')
    },
    favSearch: document.getElementById('fav-search'),
    favSearchClear: document.getElementById('fav-search-clear'),
    favHintBar: document.getElementById('fav-hint-bar'),
    favGrid: document.getElementById('fav-grid'),
    btnSortFavName: document.getElementById('btn-sort-fav-name'),
    btnSortFavOwner: document.getElementById('btn-sort-fav-owner'),
    btnGotoBrowse: document.getElementById('btn-goto-browse'),
    optPinCurrentChannel: document.getElementById('opt-pin-current-channel'),
    btnResetChannelOrder: document.getElementById('btn-reset-channel-order'),
    channelList: document.getElementById('channel-list'),
    browseSearch: document.getElementById('browse-search'),
    browseSearchClear: document.getElementById('browse-search-clear'),
    browseChannelFilter: document.getElementById('browse-channel-filter'),
    browseOnlyFav: document.getElementById('browse-only-fav'),
    browseSections: document.getElementById('browse-sections'),
    toast: document.getElementById('toast')
  };

  function showToast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 2200);
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

  function createEmoteImage(id, altText, className) {
    const img = document.createElement('img');
    img.className = className;
    img.src = getEmoteImageUrl(id, 'dark', '3.0');
    img.alt = altText || '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      if (!img.dataset.step) {
        img.dataset.step = '2';
        img.src = getEmoteImageUrl(id, 'dark', '2.0');
      } else if (img.dataset.step === '2') {
        img.dataset.step = '1';
        img.src = getEmoteImageUrl(id, 'dark', '1.0');
      }
    });
    return img;
  }

  function createAvatarElement(group, imgClass, fallbackClass) {
    if (group.type === 'global') {
      const span = document.createElement('span');
      span.className = fallbackClass;
      span.style.background = '#53535f';
      const svgSize = imgClass === 'channel-avatar' ? 24 : 16;
      span.innerHTML = `
        <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clip-rule="evenodd"/>
        </svg>
      `;
      return span;
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
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        const fb = makeFallback();
        if (img.parentNode) img.parentNode.replaceChild(fb, img);
      });
      return img;
    }

    return makeFallback();
  }

  function pushUndo(kind, snapshot) {
    undoStack.push({
      kind,
      value: JSON.parse(JSON.stringify(snapshot))
    });
    if (undoStack.length > 30) {
      undoStack.shift();
    }
    updateUndoButton();
  }

  function updateUndoButton() {
    if (els.btnUndo) {
      els.btnUndo.disabled = undoStack.length === 0;
    }
  }

  async function performUndo() {
    if (undoStack.length === 0) return;
    const entry = undoStack.pop();
    updateUndoButton();

    if (entry.kind === 'favorites') {
      state.favorites = entry.value;
      await storage.saveFavorites(entry.value);
      renderAll();
      showToast('お気に入りの変更を元に戻しました');
    } else if (entry.kind === 'groupOrder') {
      state.groupOrder = entry.value;
      await storage.saveGroupOrder(entry.value);
      renderAll();
      showToast('配信者の並び順を元に戻しました');
    }
  }

  function maybeAutoScroll(clientY) {
    const margin = 72;
    if (clientY < margin) {
      window.scrollBy(0, -14);
    } else if (clientY > window.innerHeight - margin) {
      window.scrollBy(0, 14);
    }
  }

  function renderStats() {
    const ordered = storage.computeOrderedGroups(state.catalog.groups, state.groupOrder);
    const totalEmotes = ordered.reduce((sum, g) => sum + g.emotes.length, 0);
    els.statFavorites.textContent = String(state.favorites.length);
    els.statGroups.textContent = String(ordered.filter(group => group.type !== 'global').length);
    els.statEmotes.textContent = String(totalEmotes);
  }

  // --- Tab 1: Favorites Reorder ---
  async function moveFavorite(fromIdx, toIdx, label) {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= state.favorites.length) return;
    pushUndo('favorites', state.favorites);
    const nextFavs = storage.reorderList(state.favorites, fromIdx, toIdx);
    state.favorites = nextFavs;
    renderFavoritesTab();
    renderStats();
    await storage.saveFavorites(nextFavs);
    showToast(label || 'お気に入りの順番を保存しました');
  }

  async function removeFavorite(id, token) {
    pushUndo('favorites', state.favorites);
    const nextFavs = state.favorites.filter((f) => f.id !== id);
    state.favorites = nextFavs;
    renderAll();
    await storage.saveFavorites(nextFavs);
    showToast(`「${token}」をお気に入りから外しました`);
  }

  function attachFavCardDrag(cardEl, fav, index) {
    cardEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || favSearch.trim() !== '' || state.favorites.length < 2) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const pressStartedAt = Date.now();
      let holdCancelled = false;
      let dragging = false;
      let ghost = null;
      let hoveredIdx = index;
      let placeAfter = false;

      function clearIndicators() {
        const cards = els.favGrid.querySelectorAll('.fav-card');
        for (let i = 0; i < cards.length; i++) {
          cards[i].classList.remove('drop-before', 'drop-after');
        }
      }

      function updateTarget(clientX, clientY) {
        clearIndicators();
        const cards = Array.from(els.favGrid.querySelectorAll('.fav-card[data-fav-index]'));
        let bestCard = null;
        let bestDist = Infinity;

        for (let i = 0; i < cards.length; i++) {
          const r = cards[i].getBoundingClientRect();
          if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            bestCard = cards[i];
            break;
          }
          const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
          if (d < bestDist) {
            bestDist = d;
            bestCard = cards[i];
          }
        }

        if (!bestCard) return;
        const targetIdx = Number(bestCard.getAttribute('data-fav-index'));
        const rect = bestCard.getBoundingClientRect();
        placeAfter = clientX > rect.left + rect.width / 2;
        hoveredIdx = targetIdx;
        if (targetIdx !== index) {
          bestCard.classList.add(placeAfter ? 'drop-after' : 'drop-before');
        }
      }

      function onMove(ev) {
        if (!dragging) {
          const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
            if (Date.now() - pressStartedAt < 450) {
              if (distance > 8) holdCancelled = true;
              return;
            }
            if (holdCancelled || distance < 6) return;
          dragging = true;
          cardEl.classList.add('dragging-source');

          ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          const img = createEmoteImage(fav.id, fav.token, 'card-img');
          img.style.width = '44px';
          img.style.height = '44px';
          const lbl = document.createElement('span');
          lbl.textContent = fav.token;
          lbl.style.fontWeight = '700';
          ghost.appendChild(img);
          ghost.appendChild(lbl);
          document.body.appendChild(ghost);
        }

        if (ghost) {
          ghost.style.left = `${ev.clientX}px`;
          ghost.style.top = `${ev.clientY}px`;
        }
        maybeAutoScroll(ev.clientY);
        updateTarget(ev.clientX, ev.clientY);
      }

      function cleanup() {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
        cardEl.classList.remove('dragging-source');
        clearIndicators();
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      }

      function onEnd(ev) {
        cleanup();
        if (!dragging || (ev && ev.type === 'pointercancel')) return;
        let toIdx = hoveredIdx;
        if (placeAfter && toIdx < index) toIdx += 1;
        if (!placeAfter && toIdx > index) toIdx -= 1;
        toIdx = Math.max(0, Math.min(state.favorites.length - 1, toIdx));
        if (toIdx !== index) {
          moveFavorite(index, toIdx, `「${fav.token}」を #${toIdx + 1} に移動しました`);
        }
      }

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onEnd, true);
      window.addEventListener('pointercancel', onEnd, true);
    });
  }

  function renderFavoritesTab() {
    if (!els.favGrid) return;
    const query = favSearch.trim().toLowerCase();
    const isFiltering = query.length > 0;

    if (els.favHintBar) {
      els.favHintBar.hidden = !isFiltering;
      els.favHintBar.textContent = isFiltering ? '検索を解除すると並べ替えできます。' : '';
    }

    const list = isFiltering
      ? state.favorites
          .map((fav, originalIndex) => ({ fav, originalIndex }))
          .filter(
            ({ fav }) =>
              fav.token.toLowerCase().includes(query) ||
              String(fav.ownerName || '').toLowerCase().includes(query)
          )
      : state.favorites.map((fav, originalIndex) => ({ fav, originalIndex }));

    els.favGrid.innerHTML = '';

    if (state.favorites.length === 0) {
      els.favGrid.style.display = 'block';
      const empty = document.createElement('div');
      empty.className = 'empty-box';
      empty.innerHTML = `
        <h3>お気に入りスタンプがまだありません</h3>
        <p style="margin:0;">「スタンプ一覧」タブから追加するか、Twitchチャットのスタンプピッカーでスタンプを右クリックして登録できます。</p>
      `;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = 'スタンプ一覧からお気に入りを追加する';
      btn.addEventListener('click', () => switchTab('browse'));
      empty.appendChild(btn);
      els.favGrid.appendChild(empty);
      return;
    }

    if (list.length === 0) {
      els.favGrid.style.display = 'block';
      const empty = document.createElement('div');
      empty.className = 'empty-box';
      const heading = document.createElement('h3');
      heading.textContent = `「${favSearch}」に一致するお気に入りがありません`;
      empty.appendChild(heading);
      els.favGrid.appendChild(empty);
      return;
    }

    els.favGrid.style.display = '';
    for (let i = 0; i < list.length; i++) {
      const { fav, originalIndex } = list[i];
      const card = document.createElement('div');
      card.className = 'fav-card' + (isFiltering ? ' no-drag' : '');
      card.setAttribute('data-fav-index', String(originalIndex));

      const rank = document.createElement('span');
      rank.className = 'card-rank';
      rank.textContent = `#${originalIndex + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'card-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'お気に入りから外す';
      removeBtn.addEventListener('click', () => removeFavorite(fav.id, fav.token));

      const imgWrap = document.createElement('div');
      imgWrap.className = 'card-img-wrap';
      imgWrap.appendChild(createEmoteImage(fav.id, fav.token, 'card-img'));

      const token = document.createElement('div');
      token.className = 'card-token';
      token.textContent = fav.token;
      token.title = fav.token;

      const owner = document.createElement('div');
      owner.className = 'card-owner';
      owner.textContent = fav.ownerName || 'Twitch';
      owner.title = fav.ownerName || 'Twitch';

      const actions = document.createElement('div');
      actions.className = 'fav-actions';
      const lastIdx = state.favorites.length - 1;

      const moveDefs = [
        { label: '⇤', title: '先頭へ移動', to: 0, disabled: originalIndex === 0 },
        { label: '←', title: '1つ左へ', to: originalIndex - 1, disabled: originalIndex === 0 },
        { label: '→', title: '1つ右へ', to: originalIndex + 1, disabled: originalIndex >= lastIdx },
        { label: '⇥', title: '末尾へ移動', to: lastIdx, disabled: originalIndex >= lastIdx }
      ];
      for (let m = 0; m < moveDefs.length; m++) {
        const def = moveDefs[m];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mini-move-btn';
        b.textContent = def.label;
        b.title = def.title;
        b.disabled = def.disabled;
        b.addEventListener('click', () =>
          moveFavorite(originalIndex, def.to, `「${fav.token}」を #${def.to + 1} に移動しました`)
        );
        actions.appendChild(b);
      }

      card.appendChild(rank);
      card.appendChild(removeBtn);
      card.appendChild(imgWrap);
      card.appendChild(token);
      card.appendChild(owner);
      card.appendChild(actions);

      if (!isFiltering) {
        attachFavCardDrag(card, fav, originalIndex);
      }
      els.favGrid.appendChild(card);
    }
  }

  // --- Tab 2: Channel Order Reorder ---
  async function moveChannelGroup(orderedGroups, fromIdx, toIdx, label) {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= orderedGroups.length) return;
    pushUndo('groupOrder', state.groupOrder);
    const ids = orderedGroups.map((g) => g.groupId);
    const nextOrder = storage.reorderList(ids, fromIdx, toIdx);
    state.groupOrder = nextOrder;
    renderChannelsTab();
    renderBrowseTab();
    await storage.saveGroupOrder(nextOrder);
    showToast(label || '配信者の順番を保存しました');
  }

  function attachChannelRowDrag(rowEl, group, index, orderedGroups) {
    rowEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || orderedGroups.length < 2) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const pressStartedAt = Date.now();
      let holdCancelled = false;
      let dragging = false;
      let ghost = null;
      let hoveredIdx = index;
      let placeAfter = false;

      function clearIndicators() {
        const rows = els.channelList.querySelectorAll('.channel-row');
        for (let i = 0; i < rows.length; i++) {
          rows[i].classList.remove('drop-before', 'drop-after');
        }
      }

      function updateTarget(clientY) {
        clearIndicators();
        const rows = Array.from(els.channelList.querySelectorAll('.channel-row[data-ch-index]'));
        let bestRow = null;
        let bestDist = Infinity;

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) {
            bestRow = rows[i];
            break;
          }
          const d = Math.abs(clientY - (r.top + r.height / 2));
          if (d < bestDist) {
            bestDist = d;
            bestRow = rows[i];
          }
        }

        if (!bestRow) return;
        const targetIdx = Number(bestRow.getAttribute('data-ch-index'));
        const rect = bestRow.getBoundingClientRect();
        placeAfter = clientY > rect.top + rect.height / 2;
        hoveredIdx = targetIdx;
        if (targetIdx !== index) {
          bestRow.classList.add(placeAfter ? 'drop-after' : 'drop-before');
        }
      }

      function onMove(ev) {
        if (!dragging) {
          const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
            if (Date.now() - pressStartedAt < 450) {
              if (distance > 8) holdCancelled = true;
              return;
            }
            if (holdCancelled || distance < 6) return;
          dragging = true;
          rowEl.classList.add('dragging-source');

          ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.appendChild(createAvatarElement(group, 'browse-sec-avatar', 'browse-sec-fallback'));
          const lbl = document.createElement('span');
          lbl.textContent = group.displayName || group.login;
          lbl.style.fontWeight = '700';
          ghost.appendChild(lbl);
          document.body.appendChild(ghost);
        }

        if (ghost) {
          ghost.style.left = `${ev.clientX}px`;
          ghost.style.top = `${ev.clientY}px`;
        }
        maybeAutoScroll(ev.clientY);
        updateTarget(ev.clientY);
      }

      function cleanup() {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
        rowEl.classList.remove('dragging-source');
        clearIndicators();
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      }

      function onEnd(ev) {
        cleanup();
        if (!dragging || (ev && ev.type === 'pointercancel')) return;
        let toIdx = hoveredIdx;
        if (placeAfter && toIdx < index) toIdx += 1;
        if (!placeAfter && toIdx > index) toIdx -= 1;
        toIdx = Math.max(0, Math.min(orderedGroups.length - 1, toIdx));
        if (toIdx !== index) {
          moveChannelGroup(
            orderedGroups,
            index,
            toIdx,
            `「${group.displayName}」を #${toIdx + 1} に移動しました`
          );
        }
      }

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onEnd, true);
      window.addEventListener('pointercancel', onEnd, true);
    });
  }

  function renderChannelsTab() {
    if (!els.channelList) return;
    if (els.optPinCurrentChannel) {
      els.optPinCurrentChannel.checked = state.settings.picker.pinCurrentChannel !== false;
    }

    const ordered = storage.computeOrderedGroups(state.catalog.groups, state.groupOrder);
    els.channelList.innerHTML = '';

    if (ordered.length === 0) {
      els.channelList.innerHTML = `
        <div class="empty-box">
          <h3>配信者スタンプがまだ同期されていません</h3>
          <p style="margin:0;">Twitch またはクリエイターダッシュボードのスタンプ欄を開いて「↻」で同期してください。</p>
        </div>
      `;
      return;
    }

    for (let i = 0; i < ordered.length; i++) {
      const g = ordered[i];
      const row = document.createElement('div');
      row.className = 'channel-row';
      row.setAttribute('data-ch-index', String(i));

      const grip = document.createElement('span');
      grip.className = 'channel-grip';
      grip.textContent = '⋮⋮';

      const rank = document.createElement('span');
      rank.className = 'channel-rank';
      rank.textContent = `#${i + 1}`;

      const avatar = createAvatarElement(g, 'channel-avatar', 'channel-avatar-fallback');

      const meta = document.createElement('div');
      meta.className = 'channel-meta';
      const name = document.createElement('div');
      name.className = 'channel-name';
      name.textContent = g.displayName || g.login || g.groupId;
      const sub = document.createElement('div');
      sub.className = 'channel-sub';
      sub.textContent = `${g.emotes.length}個のスタンプ` + (g.login && g.login !== g.displayName ? ` ・ @${g.login}` : '');
      meta.appendChild(name);
      meta.appendChild(sub);

      const previews = document.createElement('div');
      previews.className = 'channel-previews';
      const previewCount = Math.min(10, g.emotes.length);
      for (let p = 0; p < previewCount; p++) {
        previews.appendChild(createEmoteImage(g.emotes[p].id, g.emotes[p].token, 'channel-preview-img'));
      }
      if (g.emotes.length > previewCount) {
        const more = document.createElement('span');
        more.className = 'channel-preview-more';
        more.textContent = `+${g.emotes.length - previewCount}`;
        previews.appendChild(more);
      }

      const actions = document.createElement('div');
      actions.className = 'channel-actions';
      const lastIdx = ordered.length - 1;
      const btns = [
        { label: '⇈', title: '最上部へ', to: 0, disabled: i === 0 },
        { label: '↑', title: '1つ上へ', to: i - 1, disabled: i === 0 },
        { label: '↓', title: '1つ下へ', to: i + 1, disabled: i >= lastIdx },
        { label: '⇊', title: '最下部へ', to: lastIdx, disabled: i >= lastIdx }
      ];
      for (let b = 0; b < btns.length; b++) {
        const def = btns[b];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'row-move-btn';
        btn.textContent = def.label;
        btn.title = def.title;
        btn.disabled = def.disabled;
        btn.addEventListener('click', () =>
          moveChannelGroup(ordered, i, def.to, `「${g.displayName}」を #${def.to + 1} に移動しました`)
        );
        actions.appendChild(btn);
      }

      row.appendChild(grip);
      row.appendChild(rank);
      row.appendChild(avatar);
      row.appendChild(meta);
      row.appendChild(previews);
      row.appendChild(actions);

      attachChannelRowDrag(row, g, i, ordered);
      els.channelList.appendChild(row);
    }
  }

  // --- Tab 3: Browse All Emotes & Add Favorites ---
  async function toggleEmoteFavoriteFromBrowse(emote, ownerName) {
    pushUndo('favorites', state.favorites);
    const prevLen = state.favorites.length;
    if (storage.channelOnlyId(emote, state.catalog) || !storage.canUseEmote(emote, {}, state.catalog)) return;
    const nextFavs = storage.toggleFavorite(state.favorites, emote, ownerName, state.catalog);
    state.favorites = nextFavs;
    renderAll();
    await storage.saveFavorites(nextFavs);
    if (nextFavs.length > prevLen) {
      showToast(`「${emote.token}」をお気に入りに追加しました`);
    } else {
      showToast(`「${emote.token}」をお気に入りから外しました`);
    }
  }

  function renderBrowseTab() {
    if (!els.browseSections) return;
    const ordered = storage.computeOrderedGroups(state.catalog.groups, state.groupOrder);
    const favIds = new Set(state.favorites.map((f) => f.id));

    // Sync channel dropdown options
    if (els.browseChannelFilter) {
      const prevVal = browseChannelFilter;
      els.browseChannelFilter.innerHTML = '<option value="">すべてのチャンネル</option>';
      for (let i = 0; i < ordered.length; i++) {
        const opt = document.createElement('option');
        opt.value = ordered[i].groupId;
        opt.textContent = `${ordered[i].displayName} (${ordered[i].emotes.length})`;
        els.browseChannelFilter.appendChild(opt);
      }
      if (ordered.some((g) => g.groupId === prevVal)) {
        els.browseChannelFilter.value = prevVal;
      } else {
        browseChannelFilter = '';
        els.browseChannelFilter.value = '';
      }
    }

    els.browseSections.innerHTML = '';

    if (ordered.length === 0) {
      els.browseSections.innerHTML = `
        <div class="empty-box">
          <h3>スタンプがまだ同期されていません</h3>
          <p style="margin:0;">Twitch またはクリエイターダッシュボードのスタンプ欄を開いて同期するとここに一覧表示されます。</p>
        </div>
      `;
      return;
    }

    const query = browseSearch.trim().toLowerCase();
    let renderedCount = 0;

    for (let i = 0; i < ordered.length; i++) {
      const g = ordered[i];
      if (browseChannelFilter && g.groupId !== browseChannelFilter) continue;

      const groupMatches = query && String(g.displayName || g.login || '').toLowerCase().includes(query);
      const emotes = g.emotes.filter((em) => {
        if (browseOnlyFav && !favIds.has(em.id)) return false;
        if (query && !groupMatches && !em.token.toLowerCase().includes(query)) return false;
        return true;
      });

      if (emotes.length === 0) continue;
      renderedCount++;

      const sec = document.createElement('div');

      const head = document.createElement('div');
      head.className = 'browse-section-head';
      head.appendChild(createAvatarElement(g, 'browse-sec-avatar', 'browse-sec-fallback'));
      const title = document.createElement('span');
      title.className = 'browse-sec-title';
      title.textContent = g.displayName || g.login || g.groupId;
      const count = document.createElement('span');
      count.className = 'browse-sec-count';
      count.textContent = `${emotes.length}個`;
      head.appendChild(title);
      head.appendChild(count);
      sec.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'browse-grid';

      for (let j = 0; j < emotes.length; j++) {
        const em = emotes[j];
        const isFav = favIds.has(em.id);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'browse-card' + (isFav ? ' is-fav' : '');
        card.title = isFav ? 'クリックでお気に入りから外す' : 'クリックでお気に入りに追加';

        const badge = document.createElement('span');
        badge.className = 'browse-star-badge';
        badge.textContent = isFav ? '★' : '☆';

        const imgWrap = document.createElement('div');
        imgWrap.className = 'card-img-wrap';
        imgWrap.appendChild(createEmoteImage(em.id, em.token, 'card-img'));

        const token = document.createElement('div');
        token.className = 'card-token';
        token.textContent = em.token;

        card.appendChild(badge);
        card.appendChild(imgWrap);
        card.appendChild(token);
        card.addEventListener('click', () => {
          toggleEmoteFavoriteFromBrowse(
            {
              id: em.id,
              token: em.token,
              groupId: g.groupId,
              assetType: em.assetType
            },
            g.displayName || g.login
          );
        });

        grid.appendChild(card);
      }

      sec.appendChild(grid);
      els.browseSections.appendChild(sec);
    }

    if (renderedCount === 0) {
      els.browseSections.innerHTML = '<div class="empty-box"><h3>条件に一致するスタンプがありません</h3></div>';
    }
  }

  function renderAll() {
    const scrollY = window.scrollY;
    renderStats();
    renderFavoritesTab();
    renderChannelsTab();
    renderBrowseTab();
    window.scrollTo(window.scrollX, scrollY);
  }

  function switchTab(tabName) {
    const valid = ['favorites', 'channels', 'browse'];
    activeTab = valid.includes(tabName) ? tabName : 'favorites';

    for (let i = 0; i < els.tabBtns.length; i++) {
      const b = els.tabBtns[i];
      const active = b.dataset.tab === activeTab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
    }
    for (const key of Object.keys(els.panels)) {
      if (els.panels[key]) {
        els.panels[key].classList.toggle('active', key === activeTab);
      }
    }
    if (location.hash !== '#' + activeTab) {
      history.replaceState(null, '', '#' + activeTab);
    }
  }

  function bindEvents() {
    for (let i = 0; i < els.tabBtns.length; i++) {
      els.tabBtns[i].addEventListener('click', () => switchTab(els.tabBtns[i].dataset.tab));
      els.tabBtns[i].addEventListener('keydown', (event) => {
        let target;
        if (event.key === 'ArrowRight') target = els.tabBtns[(i + 1) % els.tabBtns.length];
        if (event.key === 'ArrowLeft') target = els.tabBtns[(i + els.tabBtns.length - 1) % els.tabBtns.length];
        if (event.key === 'Home') target = els.tabBtns[0];
        if (event.key === 'End') target = els.tabBtns[els.tabBtns.length - 1];
        if (target) {
          event.preventDefault();
          switchTab(target.dataset.tab);
          target.focus();
        }
      });
    }

    for (let i = 0; i < els.sizeBtns.length; i++) {
      const btn = els.sizeBtns[i];
      btn.addEventListener('click', () => {
        const size = btn.dataset.size || 'large';
        document.body.setAttribute('data-card-size', size);
        for (let j = 0; j < els.sizeBtns.length; j++) {
          els.sizeBtns[j].classList.toggle('active', els.sizeBtns[j] === btn);
        }
      });
    }

    els.btnUndo.addEventListener('click', performUndo);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          performUndo();
        }
      }
    });

    // Favorites toolbar
    els.favSearch.addEventListener('input', () => {
      favSearch = els.favSearch.value;
      els.favSearchClear.classList.toggle('visible', favSearch.length > 0);
      renderFavoritesTab();
    });
    els.favSearchClear.addEventListener('click', () => {
      favSearch = '';
      els.favSearch.value = '';
      els.favSearchClear.classList.remove('visible');
      renderFavoritesTab();
    });

    els.btnSortFavName.addEventListener('click', async () => {
      if (state.favorites.length < 2) return;
      pushUndo('favorites', state.favorites);
      const sorted = state.favorites
        .slice()
        .sort((a, b) => a.token.localeCompare(b.token, 'ja'));
      state.favorites = sorted;
      renderFavoritesTab();
      await storage.saveFavorites(sorted);
      showToast('お気に入りを名前順に並べ替えました');
    });

    els.btnSortFavOwner.addEventListener('click', async () => {
      if (state.favorites.length < 2) return;
      pushUndo('favorites', state.favorites);
      const sorted = state.favorites
        .slice()
        .sort(
          (a, b) =>
            String(a.ownerName || '').localeCompare(String(b.ownerName || ''), 'ja') ||
            a.token.localeCompare(b.token, 'ja')
        );
      state.favorites = sorted;
      renderFavoritesTab();
      await storage.saveFavorites(sorted);
      showToast('お気に入りを配信者順に並べ替えました');
    });

    els.btnGotoBrowse.addEventListener('click', () => switchTab('browse'));

    // Channels toolbar
    els.optPinCurrentChannel.addEventListener('change', async () => {
      const merged = await storage.saveSettings({
        picker: { pinCurrentChannel: els.optPinCurrentChannel.checked }
      });
      state.settings = merged;
      showToast('現在チャンネルの表示設定を更新しました');
    });

    els.btnResetChannelOrder.addEventListener('click', async () => {
      const orderedDefault = storage.computeOrderedGroups(state.catalog.groups, []);
      if (orderedDefault.length === 0) return;
      pushUndo('groupOrder', state.groupOrder);
      const nextOrder = orderedDefault.map((g) => g.groupId);
      state.groupOrder = nextOrder;
      renderChannelsTab();
      renderBrowseTab();
      await storage.saveGroupOrder(nextOrder);
      showToast('配信者の並び順を名前順にリセットしました');
    });

    // Browse toolbar
    els.browseSearch.addEventListener('input', () => {
      browseSearch = els.browseSearch.value;
      els.browseSearchClear.classList.toggle('visible', browseSearch.length > 0);
      renderBrowseTab();
    });
    els.browseSearchClear.addEventListener('click', () => {
      browseSearch = '';
      els.browseSearch.value = '';
      els.browseSearchClear.classList.remove('visible');
      renderBrowseTab();
    });
    els.browseChannelFilter.addEventListener('change', () => {
      browseChannelFilter = els.browseChannelFilter.value;
      renderBrowseTab();
    });
    els.browseOnlyFav.addEventListener('change', () => {
      browseOnlyFav = els.browseOnlyFav.checked;
      renderBrowseTab();
    });

    storage.onChanged((changes) => {
      if (changes[STORAGE_KEYS.SETTINGS]) {
        state.settings = deepMergeSettings(
          DEFAULT_SETTINGS,
          changes[STORAGE_KEYS.SETTINGS].newValue || {}
        );
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
      renderAll();
    });
  }

  function renderVersion() {
    const ver =
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest
        ? chrome.runtime.getManifest().version
        : '';
    if (els.extVersion && ver) {
      els.extVersion.textContent = ` · v${ver}`;
    }
  }

  async function init() {
    renderVersion();
    const initialTab = location.hash ? location.hash.replace(/^#/, '') : 'favorites';
    switchTab(initialTab);
    bindEvents();
    state = await storage.loadAll();
    renderAll();
  }

  init();
})();
