const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../shared/emote-parser.js');
const storage = require('../shared/storage.js');

const emote = { id: 'license', token: 'vivahLicense' };
const metadata = { data: { channel: { id: 'viva', localEmoteSets: [{ id: 'followers', emotes: [emote] }] } } };
function snapshot(channelId, emotes = [emote]) {
  return parser.extractEmotesFromGqlPayload({ data: { channel: { id: channelId,
    self: { availableEmoteSets: [{ id: 'followers', owner: { id: 'viva', login: 'vivah' }, emotes }] }
  } } }, { completeViewerSnapshot: true });
}
function merge(catalog, extracted) { return parser.mergeEmoteCatalog(catalog, extracted).catalog; }

test('authoritative cross-channel access overrides follower origin, regardless of metadata arrival order', () => {
  const local = parser.extractEmotesFromGqlPayload(metadata);
  for (const catalog of [merge(merge(null, local), snapshot('other')), merge(merge(null, snapshot('other')), local)]) {
    assert.equal(storage.canUseEmote(emote, { id: 'other' }, catalog), true);
    assert.equal(storage.channelOnlyId(emote, catalog), '');
    assert.equal(storage.toggleFavorite([], emote, 'vivah', catalog).length, 1);
    assert.equal(storage.computeOrderedGroups(catalog.groups, [], { currentChannel: { id: 'other' }, catalog }).length, 1);
  }
});

test('own-channel follower access stays channel scoped and cannot be favorited', () => {
  const catalog = merge(merge(null, parser.extractEmotesFromGqlPayload(metadata)), snapshot('viva'));
  assert.equal(storage.canUseEmote(emote, { id: 'viva' }, catalog), true);
  assert.equal(storage.canUseEmote(emote, { id: 'other' }, catalog), false);
  assert.deepEqual(storage.toggleFavorite([], emote, 'vivah', catalog), []);
});

test('revoked access and public catalog updates cannot restore global follower access', () => {
  let catalog = merge(merge(null, parser.extractEmotesFromGqlPayload(metadata)), snapshot('other'));
  const favorites = storage.toggleFavorite([], emote, 'vivah', catalog);
  catalog = merge(catalog, snapshot('other', []));
  catalog = merge(catalog, parser.extractEmotesFromGqlPayload(metadata));
  assert.equal(storage.canUseEmote(emote, { id: 'other' }, catalog), false);
  assert.deepEqual(catalog.globallyUsableEmoteIds, []);
  assert.deepEqual(storage.visibleFavorites(favorites, catalog, { id: 'other' }), []);
  assert.deepEqual(storage.filterFavorites(favorites, catalog), favorites);
  catalog = merge(catalog, snapshot('other'));
  assert.deepEqual(storage.visibleFavorites(favorites, catalog, { id: 'other' }), favorites);
});

test('partial responses cannot change the authoritative permission channel', () => {
  let catalog = merge(merge(null, parser.extractEmotesFromGqlPayload(metadata)), snapshot('other'));
  catalog = merge(catalog, { ...snapshot('viva'), completeViewerSnapshot: false });
  assert.equal(catalog.permissionChannelId, 'other');
  assert.equal(storage.canUseEmote(emote, { id: 'other' }, catalog), true);
});
