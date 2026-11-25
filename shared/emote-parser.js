(function (root, factory) {
  const api = factory();
  root.TCC = root.TCC || {};
  root.TCC.emoteParser = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RECENT_SECTION_NAMES = new Set([
    'frequently used',
    'recent',
    'recently used',
    'よく使うスタンプ',
    '最近使ったスタンプ',
    '最近使用したスタンプ',
    '履歴'
  ]);

  const GLOBAL_SECTION_NAMES = new Set([
    'global',
    'global emotes',
    'twitch global',
    'グローバル',
    'グローバルスタンプ',
    'twitch',
    'unlocks',
    'special',
    'イベント',
    'アンロック済み'
  ]);

  function extractEmoteIdFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const v2Match = url.match(/\/emoticons\/v2\/([^/?#]+)\//i);
    if (v2Match && v2Match[1]) {
      try {
        return decodeURIComponent(v2Match[1]);
      } catch (_) {
        return v2Match[1];
      }
    }
    const v1Match = url.match(/\/emoticons\/v1\/(\d+)\//i);
    if (v1Match && v1Match[1]) {
      return v1Match[1];
    }
    return null;
  }

  function pickAvatarUrl(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return String(
      obj.profileImageURL ||
      obj.profileImageUrl ||
      obj.avatarUrl ||
      obj.avatarURL ||
      ''
    ).trim();
  }

  function upsertOwnerProfile(profiles, userObj) {
    if (!userObj || typeof userObj !== 'object') return;
    const id = userObj.id != null ? String(userObj.id).trim() : '';
    const login = typeof userObj.login === 'string' ? userObj.login.trim().toLowerCase() : '';
    const displayName = typeof userObj.displayName === 'string' ? userObj.displayName.trim() : '';
    const avatarUrl = pickAvatarUrl(userObj);

    if (!id && !login) return;
    // Ignore non-user objects unless they have login/displayName/avatarUrl
    if (!login && !displayName && !avatarUrl) return;

    const key = id || `login:${login}`;
    const existing = profiles[key] || { id: id || '', login: '', displayName: '', avatarUrl: '' };
    profiles[key] = {
      id: id || existing.id,
      login: login || existing.login,
      displayName: displayName || existing.displayName || login || existing.login,
      avatarUrl: avatarUrl || existing.avatarUrl
    };
  }

  function isNodeExplicitlyLocked(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.isUnlocked === false || node.locked === true || node.isLocked === true) return true;
    if (node.state === 'LOCKED') return true;
    if (node.canRedeem === false) return true;
    if (node.self && typeof node.self === 'object') {
      if (node.self.isSubscribed === false || node.self.canRedeem === false || node.self.isUnlocked === false) {
        return true;
      }
    }
    return false;
  }

  function isSubscriptionProductUnlocked(productNode) {
    if (!productNode || typeof productNode !== 'object') return false;
    if (productNode.isSubscribed === true || productNode.isUnlocked === true || productNode.canRedeem === true) {
      return true;
    }
    if (productNode.self && typeof productNode.self === 'object') {
      if (
        productNode.self.isSubscribed === true ||
        productNode.self.canRedeem === true ||
        productNode.self.isUnlocked === true
      ) {
        return true;
      }
    }
    return false;
  }

  function extractEmotesFromGqlPayload(payload, options = {}) {
    const ownerProfiles = {};
    const groupMap = new Map();
    const seen = new WeakSet();
    let completeViewerSnapshot = false;
    const channelOnlyEmotes = {};
    const responseErrors = (Array.isArray(payload) ? payload : [payload]).some(response => response?.errors?.length);

    function ensureGroup(ownerInfo, explicitGlobal) {
      if (explicitGlobal || !ownerInfo || (!ownerInfo.id && !ownerInfo.login)) {
        if (!groupMap.has('global')) {
          groupMap.set('global', {
            groupId: 'global',
            type: 'global',
            ownerId: '',
            login: '',
            displayName: 'グローバル',
            avatarUrl: '',
            emotes: [],
            setIds: []
          });
        }
        return groupMap.get('global');
      }

      const ownerId = ownerInfo.id ? String(ownerInfo.id).trim() : '';
      const login = ownerInfo.login ? String(ownerInfo.login).trim().toLowerCase() : '';
      const groupId = ownerId ? `channel:${ownerId}` : `channel_login:${login}`;

      const profile = (ownerId && ownerProfiles[ownerId]) || (login && ownerProfiles[`login:${login}`]) || {};
      const displayName =
        (ownerInfo.displayName && String(ownerInfo.displayName).trim()) ||
        profile.displayName ||
        login ||
        ownerId;
      const avatarUrl = pickAvatarUrl(ownerInfo) || profile.avatarUrl || '';

      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          groupId,
          type: 'channel',
          ownerId,
          login: login || profile.login || '',
          displayName,
          avatarUrl,
          emotes: [],
          setIds: []
        });
      } else {
        const g = groupMap.get(groupId);
        if (!g.ownerId && ownerId) g.ownerId = ownerId;
        if (!g.login && (login || profile.login)) g.login = login || profile.login;
        if (displayName && (g.displayName === g.login || !g.displayName)) g.displayName = displayName;
        if (!g.avatarUrl && avatarUrl) g.avatarUrl = avatarUrl;
      }
      return groupMap.get(groupId);
    }

    function addEmoteToGroup(group, emoteObj, fallbackSetId) {
      if (!emoteObj || typeof emoteObj !== 'object') return;
      if (isNodeExplicitlyLocked(emoteObj)) return;

      const id = emoteObj.id != null ? String(emoteObj.id).trim() : '';
      const token = String(emoteObj.token || emoteObj.code || emoteObj.text || '').trim();
      if (!id || !token) return;

      const setId = String(emoteObj.setID || emoteObj.setId || fallbackSetId || 'default').trim();
      const rawType = String(emoteObj.assetType || emoteObj.type || 'STATIC').toUpperCase();
      const assetType = rawType.includes('ANIMATED') ? 'ANIMATED' : 'STATIC';

      if (setId && !group.setIds.includes(setId)) {
        group.setIds.push(setId);
      }
      const existingIdx = group.emotes.findIndex((e) => e.id === id);
      if (existingIdx === -1) {
        group.emotes.push({ id, token, assetType, setId });
      } else {
        const prev = group.emotes[existingIdx];
        if (!prev.setId && setId) prev.setId = setId;
        if (prev.assetType !== 'ANIMATED' && assetType === 'ANIMATED') prev.assetType = 'ANIMATED';
      }
    }

    function walk(node, ctx) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          walk(node[i], ctx);
        }
        return;
      }

      // Capture any user / owner profile information
      const typename = node.__typename;
      if (options.completeViewerSnapshot === true && !responseErrors && ctx.parentKey === 'currentUser' &&
          (Array.isArray(node.emoteSets) || Array.isArray(node.availableEmotesForChannel))) completeViewerSnapshot = true;
      if (options.completeViewerSnapshot === true && !responseErrors &&
          ctx.parentKey === 'self' && ctx.channelOwner && Array.isArray(node.availableEmoteSets)) {
        completeViewerSnapshot = true;
      }
      // Public channel catalogs do not prove that the viewer may use these emotes.
      // Only viewer-specific lists and unlocked native picker entries are usable.
      if (ctx.parentKey === 'localEmoteSets' || ctx.parentKey === 'followerEmoteSets') {
        // Public local sets identify channel-only emotes, but never grant usage.
        const channelId = ctx.channelOwner?.id;
        if (channelId && Array.isArray(node.emotes)) {
          for (const emote of node.emotes) {
            if (emote?.id) channelOnlyEmotes[String(emote.id)] = String(channelId);
          }
        }
        return;
      }
      if (
        typename === 'User' ||
        typename === 'Channel' ||
        (node.id && (node.login || node.displayName) && (pickAvatarUrl(node) || node.login))
      ) {
        if (ctx.parentKey !== 'emote' && !Array.isArray(node.emotes)) {
          upsertOwnerProfile(ownerProfiles, node);
        }
      }
      if (node.owner && typeof node.owner === 'object') {
        upsertOwnerProfile(ownerProfiles, node.owner);
      }

      // Check subscriptionProduct gating
      const isSubProduct =
        typename === 'SubscriptionProduct' ||
        ctx.parentKey === 'subscriptionProducts' ||
        (typeof node.tier === 'string' && Array.isArray(node.emotes));

      if (isSubProduct && !isSubscriptionProductUnlocked(node)) {
        // Skip locked/unsubscribed tier product emotes unless individual emotes are explicitly unlocked
        if (Array.isArray(node.emotes)) {
          const anyExplicitlyUnlocked = node.emotes.some((e) => e && e.isUnlocked === true);
          if (!anyExplicitlyUnlocked) return;
        } else {
          return;
        }
      }

      const nextCtx = {
        channelOwner: ctx.channelOwner,
        inCurrentUser: ctx.inCurrentUser,
        inChannelSelf: ctx.inChannelSelf,
        parentKey: ctx.parentKey,
        locked: ctx.locked || isNodeExplicitlyLocked(node)
      };

      // Track ancestor channel/user (excluding currentUser) for localEmoteSets/followerEmoteSets
      if (
        (ctx.parentKey === 'channel' || ctx.parentKey === 'user') &&
        (node.id || node.login)
      ) {
        nextCtx.channelOwner = node;
        nextCtx.inCurrentUser = false;
      } else if (ctx.parentKey === 'currentUser') {
        nextCtx.inCurrentUser = true;
        nextCtx.channelOwner = null;
      }

      // channel.self.availableEmoteSets is Twitch's viewer-specific usable list.
      if (ctx.parentKey === 'self' && ctx.channelOwner) nextCtx.inChannelSelf = true;
      if (ctx.parentKey === 'availableEmoteSets' && ctx.inChannelSelf) nextCtx.inCurrentUser = true;

      // Handle an object with an `emotes` array (EmoteSet, SubscriptionProduct, etc.)
      if (Array.isArray(node.emotes) && node.emotes.length > 0) {
        let ownerInfo = null;
        let explicitGlobal = false;

        if (Object.prototype.hasOwnProperty.call(node, 'owner')) {
          if (node.owner === null) {
            explicitGlobal = true;
          } else if (typeof node.owner === 'object') {
            ownerInfo = node.owner;
          }
        } else if (
          !nextCtx.inCurrentUser &&
          nextCtx.channelOwner &&
          (ctx.parentKey === 'localEmoteSets' ||
            ctx.parentKey === 'followerEmoteSets' ||
            ctx.parentKey === 'emoteSets' ||
            ctx.parentKey === 'cheerEmoteGroups')
        ) {
          ownerInfo = nextCtx.channelOwner;
        } else {
          explicitGlobal = true;
        }

        if (!nextCtx.locked) {
          const group = ensureGroup(ownerInfo, explicitGlobal);
          const setId = node.id != null ? String(node.id) : 'default';
          for (let i = 0; i < node.emotes.length; i++) {
            const em = node.emotes[i];
            if (!nextCtx.inCurrentUser && !explicitGlobal && !isSubscriptionProductUnlocked(node) &&
                node.isUnlocked !== true && em?.isUnlocked !== true) continue;
            if (isSubProduct && !isSubscriptionProductUnlocked(node) && em?.isUnlocked !== true) {
              continue;
            }
            addEmoteToGroup(group, em, setId);
          }
        }
      }

      // Recurse into child properties
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === 'emotes') continue; // already processed above
        const val = node[key];
        if (val && typeof val === 'object') {
          walk(val, {
            channelOwner: nextCtx.channelOwner,
            inCurrentUser: nextCtx.inCurrentUser,
            inChannelSelf: nextCtx.inChannelSelf,
            parentKey: key,
            locked: nextCtx.locked
          });
        }
      }
    }

    walk(payload, {
      channelOwner: null,
      inCurrentUser: false,
      parentKey: '',
      locked: false
    });

    // Enrich groups with ownerProfiles discovered later in the same payload
    const groups = [];
    for (const group of groupMap.values()) {
      if (group.type === 'channel') {
        const profile =
          (group.ownerId && ownerProfiles[group.ownerId]) ||
          (group.login && ownerProfiles[`login:${group.login}`]);
        if (profile) {
          if (!group.ownerId && profile.id) group.ownerId = profile.id;
          if (!group.login && profile.login) group.login = profile.login;
          if (profile.displayName && (!group.displayName || group.displayName === group.login)) {
            group.displayName = profile.displayName;
          }
          if (!group.avatarUrl && profile.avatarUrl) {
            group.avatarUrl = profile.avatarUrl;
          }
        }
      }
      if (group.emotes.length > 0) {
        groups.push(group);
      }
    }

    return { groups, ownerProfiles, completeViewerSnapshot, channelOnlyEmotes };
  }

  function cloneGroup(g) {
    return {
      groupId: g.groupId,
      type: g.type,
      ownerId: g.ownerId || '',
      login: g.login || '',
      displayName: g.displayName || '',
      avatarUrl: g.avatarUrl || '',
      emotes: Array.isArray(g.emotes) ? g.emotes.map((e) => ({ ...e })) : [],
      setIds: Array.isArray(g.setIds) ? g.setIds.slice() : []
    };
  }

  function dedupeEmotes(emotes) {
    const map = new Map();
    for (let i = 0; i < emotes.length; i++) {
      const e = emotes[i];
      if (!e || !e.id || !e.token) continue;
      const existing = map.get(e.id);
      if (!existing) {
        map.set(e.id, { ...e });
      } else {
        if ((!existing.setId || existing.setId === 'dom') && e.setId && e.setId !== 'dom') {
          existing.setId = e.setId;
        }
        if (existing.assetType !== 'ANIMATED' && e.assetType === 'ANIMATED') {
          existing.assetType = 'ANIMATED';
        }
      }
    }
    return Array.from(map.values());
  }

  function mergeEmoteCatalog(existingCatalog, extracted, options = {}) {
    const prevGroups = (existingCatalog && existingCatalog.groups) || {};
    const nextGroups = {};
    for (const gid of Object.keys(prevGroups)) {
      nextGroups[gid] = cloneGroup(prevGroups[gid]);
    }

    const channelOnlyEmotes = { ...(existingCatalog?.channelOnlyEmotes || {}), ...(extracted?.channelOnlyEmotes || {}) };
    const migratedGroupIds = {};
    const ownerProfiles = (extracted && extracted.ownerProfiles) || {};
    const extractedGroups = (extracted && extracted.groups) || [];
    const allowedIds = extracted?.completeViewerSnapshot
      ? new Set(extractedGroups.flatMap(group => (group.emotes || []).map(emote => emote.id)))
      : Array.isArray(existingCatalog?.allowedEmoteIds) ? new Set(existingCatalog.allowedEmoteIds) : null;
    const incomingGroups = allowedIds ? extractedGroups.map(group => ({ ...group,
      emotes: (group.emotes || []).filter(emote => allowedIds.has(emote.id)) })) : extractedGroups;
    if (extracted?.completeViewerSnapshot) {
      for (const group of Object.values(nextGroups)) {
        if (group.type === 'channel') {
          group.emotes = group.emotes.filter(emote => allowedIds.has(emote.id));
          group.setIds = Array.from(new Set(group.emotes.map(emote => emote.setId).filter(Boolean)));
        }
      }
    }

    // Helper to apply owner profile fields to an existing group
    function applyProfileToGroup(g, prof) {
      if (!prof) return;
      if (!g.ownerId && prof.id) g.ownerId = prof.id;
      if (!g.login && prof.login) g.login = prof.login;
      if (prof.displayName && (!g.displayName || g.displayName === g.login || g.displayName === g.ownerId)) {
        g.displayName = prof.displayName;
      }
      if (prof.avatarUrl && !g.avatarUrl) {
        g.avatarUrl = prof.avatarUrl;
      }
    }

    // Apply ownerProfiles to existing groups first
    for (const gid of Object.keys(nextGroups)) {
      const g = nextGroups[gid];
      if (g.type !== 'channel') continue;
      const prof =
        (g.ownerId && ownerProfiles[g.ownerId]) ||
        (g.login && ownerProfiles[`login:${g.login}`]) ||
        Object.values(ownerProfiles).find(
          (p) => (g.ownerId && p.id === g.ownerId) || (g.login && p.login === g.login)
        );
      if (prof) {
        applyProfileToGroup(g, prof);
      }
    }

    // Resolve destination groupId when merging temp/dom groups into canonical channel:<ownerId>
    function findMatchingCanonicalGroupId(inc) {
      if (inc.type === 'global') return 'global';
      if (inc.ownerId) return `channel:${inc.ownerId}`;
      for (const gid of Object.keys(nextGroups)) {
        const g = nextGroups[gid];
        if (g.type !== 'channel') continue;
        if (inc.login && g.login && g.login.toLowerCase() === inc.login.toLowerCase()) {
          return gid;
        }
        if (inc.displayName && g.displayName && g.displayName.toLowerCase() === inc.displayName.toLowerCase()) {
          return gid;
        }
      }
      return inc.groupId;
    }

    for (let i = 0; i < incomingGroups.length; i++) {
      const inc = incomingGroups[i];
      if (!inc || !Array.isArray(inc.emotes) || inc.emotes.length === 0) continue;

      const targetId = findMatchingCanonicalGroupId(inc);

      // Migrate any existing temp group (channel_login:<login> or channel_dom:*) into canonical channel:<ownerId>
      if (inc.ownerId && targetId.startsWith('channel:')) {
        for (const oldId of Object.keys(nextGroups)) {
          if (oldId === targetId) continue;
          const oldG = nextGroups[oldId];
          if (oldG.type !== 'channel' || oldG.ownerId) continue;
          const sameLogin = inc.login && oldG.login && oldG.login.toLowerCase() === inc.login.toLowerCase();
          const sameName = inc.displayName && oldG.displayName && oldG.displayName.toLowerCase() === inc.displayName.toLowerCase();
          if (sameLogin || sameName) {
            if (!nextGroups[targetId]) {
              nextGroups[targetId] = cloneGroup(oldG);
              nextGroups[targetId].groupId = targetId;
              nextGroups[targetId].ownerId = inc.ownerId;
            } else {
              nextGroups[targetId].emotes = dedupeEmotes([
                ...nextGroups[targetId].emotes,
                ...oldG.emotes
              ]);
              if (!nextGroups[targetId].avatarUrl && oldG.avatarUrl) {
                nextGroups[targetId].avatarUrl = oldG.avatarUrl;
              }
            }
            delete nextGroups[oldId];
            migratedGroupIds[oldId] = targetId;
          }
        }
      }

      if (!nextGroups[targetId]) {
        const created = cloneGroup(inc);
        created.groupId = targetId;
        created.emotes = dedupeEmotes(created.emotes);
        nextGroups[targetId] = created;
      } else {
        const target = nextGroups[targetId];
        if (inc.ownerId && !target.ownerId) target.ownerId = inc.ownerId;
        if (inc.login && !target.login) target.login = inc.login;
        if (inc.displayName && (!target.displayName || target.displayName === target.login || target.displayName === target.ownerId)) {
          target.displayName = inc.displayName;
        }
        if (inc.avatarUrl) {
          target.avatarUrl = inc.avatarUrl;
        }

        const incSetIds = Array.isArray(inc.setIds) ? inc.setIds.filter((s) => s && s !== 'default' && s !== 'dom') : [];
        if (options.replaceGroupEmotes) {
          target.emotes = dedupeEmotes(inc.emotes);
          target.setIds = incSetIds.slice();
        } else if (incSetIds.length > 0) {
          const replaceSet = new Set(incSetIds);
          const preserved = target.emotes.filter((e) => !e.setId || (!replaceSet.has(e.setId) && e.setId !== 'dom'));
          target.emotes = dedupeEmotes([...preserved, ...inc.emotes]);
          target.setIds = Array.from(new Set([...(target.setIds || []), ...incSetIds]));
        } else {
          target.emotes = dedupeEmotes([...target.emotes, ...inc.emotes]);
        }
      }
    }

    for (const group of Object.values(nextGroups)) {
      group.emotes = group.emotes.map(emote => channelOnlyEmotes[emote.id]
        ? { ...emote, channelOnlyId: channelOnlyEmotes[emote.id] } : emote);
    }
    for (const id of Object.keys(nextGroups)) {
      if (!nextGroups[id].emotes.length) delete nextGroups[id];
    }
    return {
      catalog: {
        groups: nextGroups,
        channelOnlyEmotes,
        permissionsUpdatedAt: extracted?.completeViewerSnapshot ? Date.now() : existingCatalog?.permissionsUpdatedAt || 0,
        ...(allowedIds ? { allowedEmoteIds: Array.from(allowedIds) } : {}),
        updatedAt: Date.now()
      },
      migratedGroupIds
    };
  }

  function extractEmotesFromNativePickerDom(rootElement) {
    if (!rootElement || typeof rootElement.querySelectorAll !== 'function') {
      return { groups: [], ownerProfiles: {} };
    }

    const emoteImgs = Array.from(
      rootElement.querySelectorAll('img[src*="jtvnw.net/emoticons"]')
    );
    if (emoteImgs.length === 0) {
      return { groups: [], ownerProfiles: {} };
    }

    const sectionsByKey = new Map();

    function findSectionContainer(imgEl) {
      let cur = imgEl.parentElement;
      for (let depth = 0; depth < 8 && cur && cur !== rootElement; depth++) {
        const aTarget = cur.getAttribute('data-a-target') || '';
        const cls = typeof cur.className === 'string' ? cur.className : '';
        if (
          aTarget.includes('section') ||
          cls.includes('emote-picker__section') ||
          cur.querySelector('h1,h2,h3,h4,h5,[data-a-target*="header"],[class*="header"]')
        ) {
          // Ensure this container isn't the entire root list wrapping multiple sections
          const headerCount = cur.querySelectorAll('h2,h3,h4,[class*="emote-picker__section-title"]').length;
          if (headerCount <= 1) return cur;
        }
        cur = cur.parentElement;
      }
      return imgEl.parentElement?.parentElement || rootElement;
    }

    function readSectionMeta(sectionEl) {
      if (!sectionEl) return { name: 'グローバル', avatarUrl: '', isRecent: false, isGlobal: true };
      const headerEl =
        sectionEl.querySelector('[class*="section-title"], [data-a-target*="section-title"], h2, h3, h4, header') ||
        sectionEl.firstElementChild;

      let name = '';
      if (headerEl) {
        name = (headerEl.textContent || '').trim().split('\n')[0].trim();
      }
      if (!name) {
        const aria = sectionEl.getAttribute('aria-label');
        if (aria) name = aria.trim();
      }

      const lower = name.toLowerCase();
      if (RECENT_SECTION_NAMES.has(lower)) {
        return { name, avatarUrl: '', isRecent: true, isGlobal: false };
      }

      let avatarUrl = '';
      const avatarImg = sectionEl.querySelector('img[src*="jtv_user_pictures"], img.tw-image-avatar');
      if (avatarImg && avatarImg.src) {
        avatarUrl = avatarImg.src;
      }

      const isGlobal = !name || GLOBAL_SECTION_NAMES.has(lower);
      return {
        name: isGlobal ? 'グローバル' : name,
        avatarUrl,
        isRecent: false,
        isGlobal
      };
    }

    for (let i = 0; i < emoteImgs.length; i++) {
      const img = emoteImgs[i];
      const btn = img.closest('button, [role="button"]');
      if (btn) {
        const cls = typeof btn.className === 'string' ? btn.className : '';
        if (
          btn.disabled ||
          btn.getAttribute('aria-disabled') === 'true' ||
          cls.includes('locked') ||
          btn.querySelector('[data-a-target*="lock"], [class*="lock"]')
        ) {
          continue;
        }
      }

      const id = extractEmoteIdFromUrl(img.getAttribute('src') || img.src || '');
      const token = (
        img.getAttribute('alt') ||
        (btn && btn.getAttribute('aria-label')) ||
        img.getAttribute('title') ||
        ''
      ).trim();

      if (!id || !token) continue;

      const sectionEl = findSectionContainer(img);
      const meta = readSectionMeta(sectionEl);
      if (meta.isRecent) continue;

      const groupId = meta.isGlobal
        ? 'global'
        : /^[a-z0-9_]{1,30}$/i.test(meta.name)
          ? `channel_login:${meta.name.toLowerCase()}`
          : `channel_dom:${meta.name.toLowerCase()}`;

      if (!sectionsByKey.has(groupId)) {
        sectionsByKey.set(groupId, {
          groupId,
          type: meta.isGlobal ? 'global' : 'channel',
          ownerId: '',
          login: meta.isGlobal || !/^[a-z0-9_]{1,30}$/i.test(meta.name) ? '' : meta.name.toLowerCase(),
          displayName: meta.name,
          avatarUrl: meta.avatarUrl,
          emotes: [],
          setIds: ['dom']
        });
      }

      const group = sectionsByKey.get(groupId);
      if (!group.avatarUrl && meta.avatarUrl) group.avatarUrl = meta.avatarUrl;
      if (!group.emotes.some((e) => e.id === id)) {
        group.emotes.push({ id, token, assetType: 'STATIC', setId: 'dom' });
      }
    }

    return {
      groups: Array.from(sectionsByKey.values()),
      ownerProfiles: {}
    };
  }

  function resolveEmote(catalog, selected) {
    if (!selected || typeof selected !== 'object') return selected;
    for (const group of Object.values((catalog && catalog.groups) || {})) {
      const current = (group.emotes || []).find((emote) => emote.id === selected.id);
      if (current) return current;
    }
    return selected;
  }

  return {
    resolveEmote,
    extractEmoteIdFromUrl,
    extractEmotesFromGqlPayload,
    mergeEmoteCatalog,
    extractEmotesFromNativePickerDom
  };
});
