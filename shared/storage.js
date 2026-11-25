(function (root, factory) {
  const constants =
    (root.TCC && root.TCC.constants) ||
    (typeof require !== 'undefined' ? require('./constants.js') : null);
  const emoteParser =
    (root.TCC && root.TCC.emoteParser) ||
    (typeof require !== 'undefined' ? require('./emote-parser.js') : null);

  const api = factory(constants, emoteParser);
  root.TCC = root.TCC || {};
  root.TCC.storage = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (constants, emoteParser) {
  'use strict';

  const { STORAGE_KEYS, DEFAULT_SETTINGS, deepMergeSettings } = constants;

  function channelOnlyId(emote, catalog) {
    return String(emote?.channelOnlyId || catalog?.channelOnlyEmotes?.[emote?.id] || '');
  }

  function filterFavorites(favorites, catalog) {
    return (Array.isArray(favorites) ? favorites : []).filter(emote => !channelOnlyId(emote, catalog));
  }

  function canUseEmote(emote, currentChannel, catalog) {
    const restrictedTo = channelOnlyId(emote, catalog);
    return !restrictedTo || restrictedTo === String(currentChannel?.id || '');
  }

  function toggleFavorite(favorites, emote, ownerName, catalog) {
    const list = Array.isArray(favorites) ? favorites.slice() : [];
    if (!emote || !emote.id) return list;

    const existingIdx = list.findIndex((f) => f && f.id === emote.id);
    if (existingIdx !== -1) {
      list.splice(existingIdx, 1);
      return list;
    }

    if (channelOnlyId(emote, catalog)) return list;

    list.push({
      id: String(emote.id),
      token: String(emote.token || ''),
      groupId: String(emote.groupId || 'global'),
      ownerName: String(ownerName || emote.ownerName || 'グローバル'),
      assetType: emote.assetType === 'ANIMATED' ? 'ANIMATED' : 'STATIC'
    });
    return list;
  }

  function reorderList(list, fromIndex, toIndex) {
    const arr = Array.isArray(list) ? list.slice() : [];
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= arr.length ||
      toIndex >= arr.length
    ) {
      return arr;
    }
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    return arr;
  }

  function findCurrentChannelGroupId(groupsMap, currentChannel) {
    if (!groupsMap || typeof groupsMap !== 'object' || !currentChannel) return null;
    const targetId = currentChannel.id != null ? String(currentChannel.id).trim() : '';
    const targetLogin =
      typeof currentChannel.login === 'string' ? currentChannel.login.trim().toLowerCase() : '';

    if (!targetId && !targetLogin) return null;

    if (targetId) {
      const direct = groupsMap[`channel:${targetId}`];
      if (direct && Array.isArray(direct.emotes) && direct.emotes.length > 0) {
        return direct.groupId || `channel:${targetId}`;
      }
      for (const gid of Object.keys(groupsMap)) {
        const g = groupsMap[gid];
        if (
          g &&
          g.type === 'channel' &&
          Array.isArray(g.emotes) &&
          g.emotes.length > 0 &&
          String(g.ownerId || '') === targetId
        ) {
          return gid;
        }
      }
    }

    if (targetLogin) {
      for (const gid of Object.keys(groupsMap)) {
        const g = groupsMap[gid];
        if (
          g &&
          g.type === 'channel' &&
          Array.isArray(g.emotes) &&
          g.emotes.length > 0 &&
          ((g.login && g.login.toLowerCase() === targetLogin) || gid === `channel_login:${targetLogin}`)
        ) {
          return gid;
        }
      }
    }

    return null;
  }

  function computeOrderedGroups(groupsMap, groupOrder, options = {}) {
    if (!groupsMap || typeof groupsMap !== 'object') return [];
    const validGroups = new Map();
    for (const gid of Object.keys(groupsMap)) {
      const g = groupsMap[gid];
      if (g && Array.isArray(g.emotes) && g.emotes.length > 0) {
        const emotes = options.currentChannel
          ? g.emotes.filter(emote => canUseEmote(emote, options.currentChannel, options.catalog))
          : g.emotes;
        if (emotes.length) validGroups.set(gid, { ...g, emotes });
      }
    }

    const ordered = [];
    const used = new Set();
    const orderList = Array.isArray(groupOrder) ? groupOrder : [];

    for (let i = 0; i < orderList.length; i++) {
      const gid = orderList[i];
      if (validGroups.has(gid) && !used.has(gid)) {
        ordered.push(validGroups.get(gid));
        used.add(gid);
      }
    }

    // Remaining groups not yet in groupOrder: channels sorted by displayName, then global last
    const remainingChannels = [];
    let remainingGlobal = null;

    for (const [gid, group] of validGroups.entries()) {
      if (used.has(gid)) continue;
      if (gid === 'global' || group.type === 'global') {
        remainingGlobal = group;
      } else {
        remainingChannels.push(group);
      }
    }

    remainingChannels.sort((a, b) =>
      String(a.displayName || a.login || a.groupId).localeCompare(
        String(b.displayName || b.login || b.groupId),
        'ja'
      )
    );

    ordered.push(...remainingChannels);
    if (remainingGlobal) {
      ordered.push(remainingGlobal);
    }

    if (options && options.pinCurrentChannel && options.currentChannel) {
      const pinnedId = findCurrentChannelGroupId(groupsMap, options.currentChannel);
      if (pinnedId) {
        const idx = ordered.findIndex((g) => g.groupId === pinnedId);
        if (idx > 0) {
          const [pinnedGroup] = ordered.splice(idx, 1);
          ordered.unshift(pinnedGroup);
        }
      }
    }

    return ordered;
  }

  function reorderGroupsWithPinned(
    visibleOrderedIds,
    savedGroupOrder,
    pinnedGroupId,
    fromVisibleIndex,
    toVisibleIndex
  ) {
    const visible = Array.isArray(visibleOrderedIds) ? visibleOrderedIds.slice() : [];
    const saved = Array.isArray(savedGroupOrder) ? savedGroupOrder.slice() : [];

    if (!pinnedGroupId || visible[0] !== pinnedGroupId) {
      return reorderList(visible, fromVisibleIndex, toVisibleIndex);
    }

    if (fromVisibleIndex <= 0 || fromVisibleIndex >= visible.length) {
      const base = [];
      const seen = new Set();
      for (let i = 0; i < saved.length; i++) {
        if (visible.includes(saved[i]) && !seen.has(saved[i])) {
          base.push(saved[i]);
          seen.add(saved[i]);
        }
      }
      for (let i = 0; i < visible.length; i++) {
        if (!seen.has(visible[i])) {
          base.push(visible[i]);
          seen.add(visible[i]);
        }
      }
      return base;
    }

    const clampedTo = Math.max(1, Math.min(visible.length - 1, toVisibleIndex));
    const nonPinned = visible.slice(1);
    const reorderedNonPinned = reorderList(nonPinned, fromVisibleIndex - 1, clampedTo - 1);

    const origIdx = saved.indexOf(pinnedGroupId);
    if (origIdx !== -1) {
      const insertIdx = Math.min(origIdx, reorderedNonPinned.length);
      reorderedNonPinned.splice(insertIdx, 0, pinnedGroupId);
    } else if (
      reorderedNonPinned.length > 0 &&
      reorderedNonPinned[reorderedNonPinned.length - 1] === 'global'
    ) {
      reorderedNonPinned.splice(reorderedNonPinned.length - 1, 0, pinnedGroupId);
    } else {
      reorderedNonPinned.push(pinnedGroupId);
    }

    return reorderedNonPinned;
  }

  function findMissingAvatarOwnerIds(catalog) {
    const groups = (catalog && catalog.groups) || {};
    const ids = [];
    for (const gid of Object.keys(groups)) {
      const g = groups[gid];
      if (g && g.type === 'channel' && g.ownerId && !g.avatarUrl) {
        ids.push(String(g.ownerId));
      }
    }
    return Array.from(new Set(ids));
  }

  function migrateIdList(list, migratedGroupIds) {
    if (!Array.isArray(list) || !migratedGroupIds) return list;
    const result = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      const mapped = migratedGroupIds[list[i]] || list[i];
      if (!seen.has(mapped)) {
        seen.add(mapped);
        result.push(mapped);
      }
    }
    return result;
  }

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function storageGet(keys) {
    if (!hasChromeStorage()) return Promise.resolve({});
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  function storageSet(items) {
    if (!hasChromeStorage()) return Promise.resolve();
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => resolve());
    });
  }

  async function loadAll() {
    const raw = await storageGet([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.CATALOG,
      STORAGE_KEYS.FAVORITES,
      STORAGE_KEYS.GROUP_ORDER,
      STORAGE_KEYS.COLLAPSED_GROUPS
    ]);

    return {
      settings: deepMergeSettings(DEFAULT_SETTINGS, raw[STORAGE_KEYS.SETTINGS] || {}),
      catalog: raw[STORAGE_KEYS.CATALOG] || { groups: {}, updatedAt: 0 },
      favorites: filterFavorites(raw[STORAGE_KEYS.FAVORITES], raw[STORAGE_KEYS.CATALOG]),
      groupOrder: Array.isArray(raw[STORAGE_KEYS.GROUP_ORDER]) ? raw[STORAGE_KEYS.GROUP_ORDER] : [],
      collapsedGroups: Array.isArray(raw[STORAGE_KEYS.COLLAPSED_GROUPS])
        ? raw[STORAGE_KEYS.COLLAPSED_GROUPS]
        : []
    };
  }

  async function saveSettings(partialSettings) {
    const raw = await storageGet([STORAGE_KEYS.SETTINGS]);
    const current = deepMergeSettings(DEFAULT_SETTINGS, raw[STORAGE_KEYS.SETTINGS] || {});
    const merged = deepMergeSettings(current, partialSettings || {});
    await storageSet({ [STORAGE_KEYS.SETTINGS]: merged });
    return merged;
  }

  // Serialize catalog merges inside the same execution context to avoid read-modify-write races
  let mergeQueue = Promise.resolve();

  function mergeAndSaveCatalog(extracted, options = {}) {
    const task = mergeQueue.then(async () => {
      const raw = await storageGet([
        STORAGE_KEYS.CATALOG,
        STORAGE_KEYS.GROUP_ORDER,
        STORAGE_KEYS.FAVORITES,
        STORAGE_KEYS.COLLAPSED_GROUPS
      ]);

      const existingCatalog = raw[STORAGE_KEYS.CATALOG] || { groups: {}, updatedAt: 0 };
      const { catalog: nextCatalog, migratedGroupIds } = emoteParser.mergeEmoteCatalog(
        existingCatalog,
        extracted,
        options
      );

      const updates = { [STORAGE_KEYS.CATALOG]: nextCatalog };
      const migratedKeys = Object.keys(migratedGroupIds || {});

      if (migratedKeys.length > 0) {
        if (Array.isArray(raw[STORAGE_KEYS.GROUP_ORDER])) {
          updates[STORAGE_KEYS.GROUP_ORDER] = migrateIdList(raw[STORAGE_KEYS.GROUP_ORDER], migratedGroupIds);
        }
        if (Array.isArray(raw[STORAGE_KEYS.COLLAPSED_GROUPS])) {
          updates[STORAGE_KEYS.COLLAPSED_GROUPS] = migrateIdList(
            raw[STORAGE_KEYS.COLLAPSED_GROUPS],
            migratedGroupIds
          );
        }
        if (Array.isArray(raw[STORAGE_KEYS.FAVORITES])) {
          updates[STORAGE_KEYS.FAVORITES] = raw[STORAGE_KEYS.FAVORITES].map((fav) => {
            if (fav && fav.groupId && migratedGroupIds[fav.groupId]) {
              return { ...fav, groupId: migratedGroupIds[fav.groupId] };
            }
            return fav;
          });
        }
      }

      const favorites = updates[STORAGE_KEYS.FAVORITES] || raw[STORAGE_KEYS.FAVORITES];
      const usableFavorites = filterFavorites(favorites, nextCatalog);
      if (Array.isArray(favorites) && usableFavorites.length !== favorites.length) {
        updates[STORAGE_KEYS.FAVORITES] = usableFavorites;
      }
      await storageSet(updates);
      return nextCatalog;
    });

    mergeQueue = task.catch(() => {});
    return task;
  }

  async function saveFavorites(favorites) {
    const raw = await storageGet([STORAGE_KEYS.CATALOG]);
    const safeList = filterFavorites(favorites, raw[STORAGE_KEYS.CATALOG]);
    await storageSet({ [STORAGE_KEYS.FAVORITES]: safeList });
    return safeList;
  }

  async function saveGroupOrder(groupOrder) {
    const safeList = Array.isArray(groupOrder) ? groupOrder : [];
    await storageSet({ [STORAGE_KEYS.GROUP_ORDER]: safeList });
    return safeList;
  }

  async function saveCollapsedGroups(collapsedGroups) {
    const safeList = Array.isArray(collapsedGroups) ? collapsedGroups : [];
    await storageSet({ [STORAGE_KEYS.COLLAPSED_GROUPS]: safeList });
    return safeList;
  }

  async function clearCatalog() {
    const empty = { groups: {}, updatedAt: 0 };
    await storageSet({ [STORAGE_KEYS.CATALOG]: empty });
    return empty;
  }

  async function exportData() {
    const state = await loadAll();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      favorites: state.favorites,
      groupOrder: state.groupOrder,
      collapsedGroups: state.collapsedGroups,
      catalog: state.catalog
    };
  }

  async function importData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('無効なJSONデータです。');
    }
    const updates = {};
    if (data.settings && typeof data.settings === 'object') {
      updates[STORAGE_KEYS.SETTINGS] = deepMergeSettings(DEFAULT_SETTINGS, data.settings);
    }
    if (Array.isArray(data.favorites)) {
      updates[STORAGE_KEYS.FAVORITES] = data.favorites;
    }
    if (Array.isArray(data.groupOrder)) {
      updates[STORAGE_KEYS.GROUP_ORDER] = data.groupOrder;
    }
    if (Array.isArray(data.collapsedGroups)) {
      updates[STORAGE_KEYS.COLLAPSED_GROUPS] = data.collapsedGroups;
    }
    if (data.catalog && typeof data.catalog === 'object' && data.catalog.groups) {
      updates[STORAGE_KEYS.CATALOG] = data.catalog;
    }
    if (Object.keys(updates).length === 0) {
      throw new Error('バックアップデータが見つかりません。');
    }
    await storageSet(updates);
    return loadAll();
  }

  function onChanged(callback) {
    if (!hasChromeStorage() || !chrome.storage.onChanged) return () => {};
    const handler = (changes, areaName) => {
      if (areaName !== 'local') return;
      callback(changes);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  return {
    channelOnlyId,
    filterFavorites,
    canUseEmote,
    toggleFavorite,
    reorderList,
    findCurrentChannelGroupId,
    computeOrderedGroups,
    reorderGroupsWithPinned,
    findMissingAvatarOwnerIds,
    loadAll,
    saveSettings,
    mergeAndSaveCatalog,
    saveFavorites,
    saveGroupOrder,
    saveCollapsedGroups,
    clearCatalog,
    exportData,
    importData,
    onChanged
  };
});
