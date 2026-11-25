const test = require('node:test');
const assert = require('node:assert/strict');

const constants = require('../shared/constants.js');
const storage = require('../shared/storage.js');

test('toggleFavorite adds and removes favorites immutably', () => {
  const initial = [];
  const emote = { id: '25', token: 'Kappa', groupId: 'global', assetType: 'STATIC' };

  const added = storage.toggleFavorite(initial, emote, 'グローバル');
  assert.equal(initial.length, 0);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0], {
    id: '25',
    token: 'Kappa',
    groupId: 'global',
    ownerName: 'グローバル',
    assetType: 'STATIC'
  });

  const removed = storage.toggleFavorite(added, emote, 'グローバル');
  assert.equal(added.length, 1);
  assert.equal(removed.length, 0);
});

test('reorderList moves items forward, backward, and ignores invalid indices', () => {
  const list = ['a', 'b', 'c', 'd'];

  assert.deepEqual(storage.reorderList(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(storage.reorderList(list, 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(storage.reorderList(list, 1, 1), ['a', 'b', 'c', 'd']);
  assert.deepEqual(storage.reorderList(list, -1, 2), ['a', 'b', 'c', 'd']);
  assert.deepEqual(storage.reorderList(list, 0, 99), ['a', 'b', 'c', 'd']);
  // Original array must stay unmodified
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
});

test('computeOrderedGroups orders by groupOrder, sorts remaining channels, puts global last by default, and drops empty groups', () => {
  const groupsMap = {
    global: { groupId: 'global', type: 'global', displayName: 'グローバル', emotes: [{ id: '1' }] },
    'channel:2': { groupId: 'channel:2', type: 'channel', displayName: 'Zed', emotes: [{ id: '2' }] },
    'channel:1': { groupId: 'channel:1', type: 'channel', displayName: 'Alpha', emotes: [{ id: '3' }] },
    'channel:3': { groupId: 'channel:3', type: 'channel', displayName: 'Beta', emotes: [{ id: '4' }] },
    'channel:empty': { groupId: 'channel:empty', type: 'channel', displayName: 'Empty', emotes: [] }
  };

  const orderedDefault = storage.computeOrderedGroups(groupsMap, ['channel:2']);
  assert.deepEqual(
    orderedDefault.map((g) => g.groupId),
    ['channel:2', 'channel:1', 'channel:3', 'global']
  );

  // Explicit global order works too
  const orderedWithGlobalFirst = storage.computeOrderedGroups(groupsMap, ['global', 'channel:3']);
  assert.deepEqual(
    orderedWithGlobalFirst.map((g) => g.groupId),
    ['global', 'channel:3', 'channel:1', 'channel:2']
  );
});

test('deepMergeSettings preserves nested defaults while applying partial overrides', () => {
  const merged = constants.deepMergeSettings(constants.DEFAULT_SETTINGS, {
    width: { chatWidthPx: 420 },
    picker: { keepOpenOnSelect: false }
  });

  assert.equal(merged.enabled, true);
  assert.equal(merged.chatEnabled, true);
  assert.equal(merged.layout, undefined);
  assert.equal(merged.width.enabled, true);
  assert.equal(merged.width.chatWidthPx, 420);
  assert.equal(merged.width.showResizeHandle, true);
  assert.equal(merged.picker.pinCurrentChannel, true);
  assert.equal(merged.picker.keepOpenOnSelect, false);
});

test('clampChatWidthPx and clampPickerWidthPx clamp values to valid pixel ranges', () => {
  assert.equal(constants.clampChatWidthPx(100), 240);
  assert.equal(constants.clampChatWidthPx(375.4), 375);
  assert.equal(constants.clampChatWidthPx(1200), 800);
  assert.equal(constants.clampChatWidthPx('invalid'), 340);

  assert.equal(constants.clampPickerWidthPx(200), 320);
  assert.equal(constants.clampPickerWidthPx(720.6), 721);
  assert.equal(constants.clampPickerWidthPx(1500), 1200);
  assert.equal(constants.clampPickerWidthPx(undefined), 680);

  assert.equal(constants.clampRewardsWidthPx(100), 280);
  assert.equal(constants.clampRewardsWidthPx(455.6), 456);
  assert.equal(constants.clampRewardsWidthPx(1200), 900);
  assert.equal(constants.clampRewardsWidthPx(undefined), 340);

  assert.equal(constants.clampRewardsHeightPx(120), 300);
  assert.equal(constants.clampRewardsHeightPx(620.4), 620);
  assert.equal(constants.clampRewardsHeightPx(1200), 850);
  assert.equal(constants.clampRewardsHeightPx('invalid'), 540);

  assert.equal(constants.normalizeWidthUnit('%'), '%');
  assert.equal(constants.normalizeWidthUnit('px'), 'px');
  assert.equal(constants.normalizeWidthUnit('invalid'), 'px');

  assert.equal(constants.clampChatWidthPct(5), 12);
  assert.equal(constants.clampChatWidthPct(24.6), 24.6);
  assert.equal(constants.clampChatWidthPct(90), 50);
  assert.equal(constants.clampChatWidthPct(undefined), 22);

  assert.equal(constants.clampPickerWidthPct(10), 10);
  assert.equal(constants.clampPickerWidthPct(0), 1);
  assert.equal(constants.clampPickerWidthPct(49.4), 49.4);
  assert.equal(constants.clampPickerWidthPct(99), 85);
  assert.equal(constants.clampPickerWidthPct(undefined), 38);

  assert.equal(constants.clampRewardsWidthPct(5), 15);
  assert.equal(constants.clampRewardsWidthPct(33.7), 33.7);
  assert.equal(constants.clampRewardsWidthPct(95), 75);
  assert.equal(constants.clampRewardsWidthPct(undefined), 22);
});

test('resolve width helpers compute px or percentage widths clamped to viewport bounds', () => {
  assert.equal(constants.resolveChatWidthPx({ chatWidthUnit: 'px', chatWidthPx: 420 }, 1920), 420);
  assert.equal(constants.resolveChatWidthPx({ chatWidthUnit: '%', chatWidthPct: 25 }, 1600), 400);
  assert.equal(constants.resolveChatWidthPx({ chatWidthUnit: '%', chatWidthPct: 50 }, 800), 400);
  assert.equal(constants.resolveChatWidthPx({ chatWidthUnit: '%', chatWidthPct: 50 }, 500), 240);

  assert.equal(constants.resolvePickerWidthPx({ pickerWidthUnit: 'px', pickerWidthPx: 700 }, 1280), 700);
  assert.equal(constants.resolvePickerWidthPx({ pickerWidthUnit: '%', pickerWidthPct: 50 }, 1280), 640);
  assert.equal(constants.resolvePickerWidthPx({ pickerWidthUnit: '%', pickerWidthPct: 85 }, 1000), 850);

  assert.equal(constants.resolveRewardsWidthPx({ widthUnit: 'px', widthPx: 360 }, 1280), 360);
  assert.equal(constants.resolveRewardsWidthPx({ widthUnit: '%', widthPct: 30 }, 1200), 360);
});

test('findMissingAvatarOwnerIds returns deduplicated channel ownerIds lacking avatarUrl', () => {
  const catalog = {
    groups: {
      global: { groupId: 'global', type: 'global', ownerId: '', avatarUrl: '' },
      'channel:10': { groupId: 'channel:10', type: 'channel', ownerId: '10', avatarUrl: '' },
      'channel:20': {
        groupId: 'channel:20',
        type: 'channel',
        ownerId: '20',
        avatarUrl: 'https://cdn.example/20.png'
      },
      'channel_dom:foo': { groupId: 'channel_dom:foo', type: 'channel', ownerId: '', avatarUrl: '' }
    }
  };

  assert.deepEqual(storage.findMissingAvatarOwnerIds(catalog), ['10']);
});

test('findCurrentChannelGroupId matches by id or case-insensitive login and ignores empty groups', () => {
  const groupsMap = {
    global: { groupId: 'global', type: 'global', displayName: 'グローバル', emotes: [{ id: '1' }] },
    'channel:101': {
      groupId: 'channel:101',
      type: 'channel',
      ownerId: '101',
      login: 'streamer_one',
      emotes: [{ id: '2' }]
    },
    'channel_login:streamer_two': {
      groupId: 'channel_login:streamer_two',
      type: 'channel',
      ownerId: '',
      login: 'streamer_two',
      emotes: [{ id: '3' }]
    },
    'channel:empty': {
      groupId: 'channel:empty',
      type: 'channel',
      ownerId: '999',
      login: 'empty_ch',
      emotes: []
    }
  };

  assert.equal(
    storage.findCurrentChannelGroupId(groupsMap, { id: '101', login: 'other' }),
    'channel:101'
  );
  assert.equal(
    storage.findCurrentChannelGroupId(groupsMap, { login: 'STREAMER_TWO' }),
    'channel_login:streamer_two'
  );
  assert.equal(
    storage.findCurrentChannelGroupId(groupsMap, { id: '999', login: 'empty_ch' }),
    null
  );
  assert.equal(
    storage.findCurrentChannelGroupId(groupsMap, { id: '404', login: 'missing' }),
    null
  );
});

test('computeOrderedGroups pins current channel first only when pinCurrentChannel is true', () => {
  const groupsMap = {
    global: { groupId: 'global', type: 'global', displayName: 'グローバル', emotes: [{ id: '1' }] },
    'channel:1': { groupId: 'channel:1', type: 'channel', ownerId: '1', login: 'alpha', displayName: 'Alpha', emotes: [{ id: '2' }] },
    'channel:2': { groupId: 'channel:2', type: 'channel', ownerId: '2', login: 'beta', displayName: 'Beta', emotes: [{ id: '3' }] },
    'channel:3': { groupId: 'channel:3', type: 'channel', ownerId: '3', login: 'gamma', displayName: 'Gamma', emotes: [{ id: '4' }] }
  };
  const savedOrder = ['channel:1', 'channel:2', 'channel:3', 'global'];

  const pinned = storage.computeOrderedGroups(groupsMap, savedOrder, {
    pinCurrentChannel: true,
    currentChannel: { login: 'gamma' }
  });
  assert.deepEqual(
    pinned.map((g) => g.groupId),
    ['channel:3', 'channel:1', 'channel:2', 'global']
  );

  const unpinned = storage.computeOrderedGroups(groupsMap, savedOrder, {
    pinCurrentChannel: false,
    currentChannel: { login: 'gamma' }
  });
  assert.deepEqual(
    unpinned.map((g) => g.groupId),
    ['channel:1', 'channel:2', 'channel:3', 'global']
  );
});

test('reorderGroupsWithPinned reorders non-pinned groups while preserving pinned channel saved position', () => {
  const visible = ['channel:3', 'channel:1', 'channel:2', 'global'];
  const savedOrder = ['channel:1', 'channel:3', 'channel:2', 'global'];

  // Move channel:2 (visible index 2) before channel:1 (visible index 1)
  const next = storage.reorderGroupsWithPinned(visible, savedOrder, 'channel:3', 2, 1);
  assert.deepEqual(next, ['channel:2', 'channel:3', 'channel:1', 'global']);

  // Attempting to drag the pinned item at index 0 should preserve savedOrder
  const ignored = storage.reorderGroupsWithPinned(visible, savedOrder, 'channel:3', 0, 2);
  assert.deepEqual(ignored, savedOrder);

  // Without a pinned item, behaves like standard reorderList
  const normal = storage.reorderGroupsWithPinned(['channel:1', 'channel:2', 'global'], savedOrder, null, 0, 1);
  assert.deepEqual(normal, ['channel:2', 'channel:1', 'global']);
});

test('deepMergeSettings preserves rewards defaults and handles legacy settings without rewards', () => {
  const defaults = constants.DEFAULT_SETTINGS;
  assert.equal(defaults.rewards.enabled, true);
  assert.equal(defaults.rewards.oneClickRedeem, true);
  assert.equal(defaults.rewards.autoCloseOnRedeem, true);
  assert.equal(defaults.rewards.precheckAvailability, true);
  assert.equal(defaults.rewards.itemSize, 'medium');
  assert.equal(defaults.rewards.widthUnit, 'px');
  assert.equal(defaults.rewards.widthPx, 340);
  assert.equal(defaults.rewards.widthPct, 22);
  assert.equal(defaults.rewards.heightPx, 540);
  assert.equal(defaults.width.chatWidthUnit, 'px');
  assert.equal(defaults.width.chatWidthPct, 22);
  assert.equal(defaults.picker.pickerWidthUnit, 'px');
  assert.equal(defaults.picker.pickerWidthPct, 38);
  assert.equal(defaults.picker.replaceNativeButton, undefined);
  assert.equal(defaults.picker.appendSpace, undefined);
  assert.equal(defaults.rewards.compactList, undefined);
  assert.equal(defaults.rewards.hideAllTab, undefined);
  assert.equal(defaults.rewards.disableAnimation, undefined);

  const legacyMerged = constants.deepMergeSettings(defaults, { chatEnabled: false });
  assert.deepEqual(legacyMerged.rewards, defaults.rewards);

  const partialRewards = constants.deepMergeSettings(defaults, {
    rewards: { oneClickRedeem: false, itemSize: 'large' }
  });
  assert.equal(partialRewards.rewards.enabled, true);
  assert.equal(partialRewards.rewards.oneClickRedeem, false);
  assert.equal(partialRewards.rewards.itemSize, 'large');
  assert.equal(partialRewards.rewards.autoCloseOnRedeem, true);
});

test('importData rejects JSON objects containing no recognized backup fields', async () => {
  await assert.rejects(() => storage.importData({ foo: 'bar' }), /バックアップデータが見つかりません/);
});


test('percentage picker widths can be narrower than 20 percent on large displays', () => {
  assert.equal(constants.resolvePickerWidthPx({pickerWidthUnit:'%',pickerWidthPct:10},3840),384);
  assert.equal(constants.resolvePickerWidthPx({pickerWidthUnit:'%',pickerWidthPct:1},3840),280);
});


test('percentage widths preserve one-pixel moves on a 3840px display after saving', () => {
  for (const [clamp,resolve,unitKey,widthKey] of [
    [constants.clampChatWidthPct,constants.resolveChatWidthPx,'chatWidthUnit','chatWidthPct'],
    [constants.clampPickerWidthPct,constants.resolvePickerWidthPx,'pickerWidthUnit','pickerWidthPct'],
    [constants.clampRewardsWidthPct,constants.resolveRewardsWidthPx,'widthUnit','widthPct']
  ]) {
    const start=resolve({[unitKey]:'%',[widthKey]:20},3840);
    for(let delta=1;delta<=8;delta++) {
      const percent=clamp((start+delta)/3840*100);
      assert.equal(resolve({[unitKey]:'%',[widthKey]:percent},3840),start+delta);
    }
  }
});


test('channel-only follower emotes stay in their channel and cannot be favorited, including legacy entries', () => {
  const follower = { id: 'follow', token: 'Follow', channelOnlyId: '100' };
  const sub = { id: 'sub', token: 'Sub' };
  const catalog = { channelOnlyEmotes: { follow: '100' }, groups: {
    'channel:100': { groupId: 'channel:100', type: 'channel', emotes: [follower, sub] },
    'channel:200': { groupId: 'channel:200', type: 'channel', emotes: [{ id: 'only', token: 'Only', channelOnlyId: '200' }] }
  } };
  const here = storage.computeOrderedGroups(catalog.groups, [], { currentChannel: { id: '100' }, catalog });
  assert.deepEqual(here.map(g => g.groupId), ['channel:100']);
  assert.deepEqual(here[0].emotes.map(e => e.id), ['follow', 'sub']);
  const elsewhere = storage.computeOrderedGroups(catalog.groups, [], { currentChannel: { id: '300' }, catalog });
  assert.deepEqual(elsewhere[0].emotes.map(e => e.id), ['sub']);
  assert.deepEqual(storage.toggleFavorite([], follower, 'Owner'), []);
  assert.deepEqual(storage.toggleFavorite([], { id: 'follow', token: 'Old' }, 'Owner', catalog), []);
  assert.deepEqual(storage.filterFavorites([{ id: 'follow' }, sub], catalog), [sub]);
  assert.equal(storage.canUseEmote(follower, { id: '300' }, catalog), false);
  assert.equal(storage.canUseEmote(follower, { id: '100' }, catalog), true);
  assert.equal(storage.canUseEmote(follower, {}, catalog), false);
  assert.equal(catalog.groups['channel:100'].emotes.length, 2);
});

test('catalog updates remove already-saved follower favorites and saveFavorites rejects them', async () => {
  const keys = constants.STORAGE_KEYS;
  const values = { [keys.CATALOG]: { groups: {} }, [keys.FAVORITES]: [{ id: 'follow' }, { id: 'sub' }] };
  const previousChrome = global.chrome;
  global.chrome = { storage: { local: {
    get(names, cb) { cb(Object.fromEntries(names.map(k => [k, values[k]]))); },
    set(updates, cb) { Object.assign(values, updates); cb(); }
  } } };
  try {
    await storage.mergeAndSaveCatalog({ groups: [], channelOnlyEmotes: { follow: '100' } });
    assert.deepEqual(values[keys.FAVORITES], [{ id: 'sub' }]);
    const saved = await storage.saveFavorites([{ id: 'follow' }, { id: 'sub' }]);
    assert.deepEqual(saved, [{ id: 'sub' }]);
    assert.deepEqual((await storage.loadAll()).favorites, [{ id: 'sub' }]);
  } finally { global.chrome = previousChrome; }
});


test('expired favorites compact without deletion and return to their original positions after resubscription', async () => {
  const parser = require('../shared/emote-parser.js');
  const a = { id: 'a', token: 'A' }, expired = { id: 'expired', token: 'OldSub' }, b = { id: 'b', token: 'B' };
  const favorites = [a, expired, b];
  const snapshot = emotes => ({ completeViewerSnapshot: true, groups: [
    { groupId: 'channel:1', type: 'channel', ownerId: '1', emotes }
  ] });
  const initial = parser.mergeEmoteCatalog(null, snapshot(favorites)).catalog;
  const expiredCatalog = parser.mergeEmoteCatalog(initial, snapshot([a, b])).catalog;
  assert.deepEqual(storage.visibleFavorites(favorites, expiredCatalog).map(e => e.id), ['a', 'b']);
  assert.deepEqual(expiredCatalog.groups['channel:1'].emotes.map(e => e.id), ['a', 'b']);
  assert.equal(storage.canUseEmote(expired, {}, expiredCatalog), false);
  assert.deepEqual(storage.toggleFavorite([], expired, 'Owner', expiredCatalog), []);
  assert.deepEqual(favorites.map(e => e.id), ['a', 'expired', 'b']);

  // Moving visible cards must leave dormant entries in their saved slots.
  const reordered = storage.reorderVisibleFavorites(favorites, storage.visibleFavorites(favorites, expiredCatalog), 1, 0);
  assert.deepEqual(reordered.map(e => e.id), ['b', 'expired', 'a']);
  const keys = constants.STORAGE_KEYS;
  const values = { [keys.CATALOG]: expiredCatalog, [keys.FAVORITES]: favorites };
  const previousChrome = global.chrome;
  global.chrome = { storage: { local: {
    get(names, cb) { cb(Object.fromEntries(names.map(k => [k, values[k]]))); },
    set(updates, cb) { Object.assign(values, updates); cb(); }
  } } };
  try {
    await storage.saveFavorites(reordered);
    assert.deepEqual((await storage.loadAll()).favorites.map(e => e.id), ['b', 'expired', 'a']);
    const renewed = await storage.mergeAndSaveCatalog(snapshot([a, { ...expired, token: 'NewSub' }, b]));
    assert.deepEqual(storage.visibleFavorites(values[keys.FAVORITES], renewed).map(e => e.id), ['b', 'expired', 'a']);
    assert.equal(parser.resolveEmote(renewed, expired).token, 'NewSub');
  } finally { global.chrome = previousChrome; }
});

test('an empty verified usable list hides all favorites without losing saved order', () => {
  const favorites = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(storage.visibleFavorites(favorites, { allowedEmoteIds: [] }), []);
  assert.deepEqual(storage.filterFavorites(favorites, { allowedEmoteIds: [] }), favorites);
  // Before any verified snapshot exists, cached favorites remain available.
  assert.deepEqual(storage.visibleFavorites(favorites, { groups: {} }), favorites);
});
