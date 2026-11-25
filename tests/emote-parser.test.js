const test = require('node:test');
const assert = require('node:assert/strict');

const constants = require('../shared/constants.js');
const emoteParser = require('../shared/emote-parser.js');

test('a complete viewer snapshot removes expired channels and locked leftovers within retained channels', () => {
  const group = (id, emotes) => ({ groupId: `channel:${id}`, type: 'channel', ownerId: id, emotes, setIds: ['old'] });
  const existing = { groups: { 'channel:1': group('1', [{ id: 'expired', token: 'Old' }]),
    'channel:2': group('2', [{ id: 'allowed', token: 'Good' }, { id: 'tier2', token: 'Locked' }]) } };
  const extracted = emoteParser.extractEmotesFromGqlPayload({ data: { currentUser: { emoteSets: [
    { id: 'new', owner: { id: '2', login: 'active' }, emotes: [{ id: 'allowed', token: 'Good' }] }
  ] } } }, { completeViewerSnapshot: true });
  const result = emoteParser.mergeEmoteCatalog(existing, extracted).catalog;
  assert.equal(result.groups['channel:1'], undefined);
  assert.deepEqual(result.groups['channel:2'].emotes.map(e => e.id), ['allowed']);
  assert.equal(existing.groups['channel:1'].emotes.length, 1);
});
test('partial responses preserve other channels and an empty verified viewer list removes cached channels', () => {
  const existing = { groups: { 'channel:1': { groupId: 'channel:1', type: 'channel', emotes: [{ id: 'old', token: 'Old' }] } } };
  const partial = emoteParser.extractEmotesFromGqlPayload({ data: { currentUser: { emoteSets: [] } } });
  assert.ok(emoteParser.mergeEmoteCatalog(existing, partial).catalog.groups['channel:1']);
  const full = emoteParser.extractEmotesFromGqlPayload({ data: { currentUser: { emoteSets: [] } } }, { completeViewerSnapshot: true });
  assert.deepEqual(emoteParser.mergeEmoteCatalog(existing, full).catalog.groups, {});
  const failed = emoteParser.extractEmotesFromGqlPayload({ errors: [{ message: 'partial' }], data: { currentUser: { emoteSets: [] } } }, { completeViewerSnapshot: true });
  assert.ok(emoteParser.mergeEmoteCatalog(existing, failed).catalog.groups['channel:1']);
});
test('public owner catalogs cannot reintroduce a channel removed from viewer permissions', () => {
  const result = emoteParser.extractEmotesFromGqlPayload({ data: { user: { id: '1', login: 'other', emoteSets: [
    { id: 'public', owner: { id: '1', login: 'other' }, emotes: [{ id: 'locked', token: 'OtherSub' }] }
  ] } } });
  assert.deepEqual(result.groups, []);
});
test('raw viewer memberships cannot restore emotes absent from the usable-for-channel snapshot', () => {
  const catalog = { groups: {}, allowedEmoteIds: ['good'] };
  const incoming = { groups: [{ groupId: 'channel:1', type: 'channel', ownerId: '1', emotes: [
    { id: 'good', token: 'Allowed' }, { id: 'followerElsewhere', token: 'NotHere' }
  ] }] };
  const merged = emoteParser.mergeEmoteCatalog(catalog, incoming).catalog;
  assert.deepEqual(merged.groups['channel:1'].emotes.map(emote => emote.id), ['good']);
});

test('public channel emote sets do not grant viewer permission', () => {
  const emotes = [{ id: 'locked', token: 'OnlyFollowers' }];
  for (const key of ['localEmoteSets', 'followerEmoteSets']) {
    const result = emoteParser.extractEmotesFromGqlPayload({ data: {
      user: { id: '100', login: 'someone', [key]: [{ id: 'local', emotes }] }
    } });
    assert.deepEqual(result.groups, []);
  }
});

test('current viewer sets remain available and renamed favorites resolve by ID', () => {
  const selected = { id: 'emotesv2_abc', token: 'OldName' };
  const current = { ...selected, token: 'NewName', setId: 'user-set' };
  const extracted = emoteParser.extractEmotesFromGqlPayload({ data: { currentUser: {
    emoteSets: [{ id: 'user-set', owner: null, emotes: [current] }]
  } } });
  const catalog = emoteParser.mergeEmoteCatalog(null, extracted).catalog;
  assert.equal(emoteParser.resolveEmote(catalog, selected).token, 'NewName');
  assert.equal(selected.token, 'OldName');
  assert.equal(emoteParser.resolveEmote(catalog, { id: 'other', token: 'Kappa' }).token, 'Kappa');
});

test('extractEmoteIdFromUrl handles v2, v1, and invalid URLs', () => {
  assert.equal(
    emoteParser.extractEmoteIdFromUrl(
      'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc123/default/dark/2.0'
    ),
    'emotesv2_abc123'
  );
  assert.equal(
    emoteParser.extractEmoteIdFromUrl('https://static-cdn.jtvnw.net/emoticons/v1/25/2.0'),
    '25'
  );
  assert.equal(
    emoteParser.extractEmoteIdFromUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/avatar.png'),
    null
  );
});

test('extractEmotesFromGqlPayload merges same-owner sets, separates global, and filters locked emotes', () => {
  const payload = [
    {
      data: {
        currentUser: {
          id: '999',
          login: 'viewer_self',
          displayName: 'ViewerSelf',
          profileImageURL: 'https://cdn.example/viewer.png',
          availableEmotesForChannel: [
            {
              id: 'set_sub_1',
              __typename: 'EmoteSet',
              owner: {
                id: '100',
                login: 'streamer_a',
                displayName: '配信者A',
                profileImageURL: 'https://cdn.example/streamer_a.png'
              },
              emotes: [
                { id: '1001', token: 'streamerSmile', assetType: 'STATIC', setID: 'set_sub_1' },
                { id: '1002', token: 'streamerDance', assetType: 'ANIMATED', setID: 'set_sub_1' },
                { id: '1003', token: 'streamerLocked', isUnlocked: false, setID: 'set_sub_1' }
              ]
            },
            {
              id: 'set_bits_1',
              __typename: 'EmoteSet',
              owner: {
                id: '100',
                login: 'streamer_a',
                displayName: '配信者A'
              },
              emotes: [
                { id: '1004', token: 'streamerCheer', assetType: 'STATIC', setID: 'set_bits_1' },
                { id: '1001', token: 'streamerSmile', assetType: 'STATIC', setID: 'set_sub_1' }
              ]
            },
            {
              id: 'set_global',
              __typename: 'EmoteSet',
              owner: null,
              emotes: [
                { id: '25', token: 'Kappa', assetType: 'STATIC', setID: 'set_global' }
              ]
            }
          ]
        },
        channel: {
          id: '100',
          subscriptionProducts: [
            {
              __typename: 'SubscriptionProduct',
              tier: '2000',
              self: { isSubscribed: false, canRedeem: false },
              emotes: [{ id: '9999', token: 'Tier2Locked', setID: 'set_t2' }]
            }
          ]
        }
      }
    }
  ];

  const { groups, ownerProfiles } = emoteParser.extractEmotesFromGqlPayload(payload);

  assert.equal(groups.length, 2);

  const channelGroup = groups.find((g) => g.groupId === 'channel:100');
  assert.ok(channelGroup);
  assert.equal(channelGroup.displayName, '配信者A');
  assert.equal(channelGroup.avatarUrl, 'https://cdn.example/streamer_a.png');
  assert.deepEqual(
    channelGroup.emotes.map((e) => e.id),
    ['1001', '1002', '1004']
  );
  assert.equal(channelGroup.emotes[1].assetType, 'ANIMATED');

  const globalGroup = groups.find((g) => g.groupId === 'global');
  assert.ok(globalGroup);
  assert.equal(globalGroup.displayName, 'グローバル');
  assert.deepEqual(
    globalGroup.emotes.map((e) => e.token),
    ['Kappa']
  );

  // currentUser must NOT be misidentified as the emote owner of global sets
  assert.equal(groups.some((g) => g.ownerId === '999'), false);
  assert.ok(ownerProfiles['100']);
});

test('mergeEmoteCatalog updates matching setIds, preserves other sets, and migrates login groups', () => {
  const existingCatalog = {
    groups: {
      'channel_login:streamer_b': {
        groupId: 'channel_login:streamer_b',
        type: 'channel',
        ownerId: '',
        login: 'streamer_b',
        displayName: 'streamer_b',
        avatarUrl: '',
        emotes: [{ id: 'e_dom', token: 'bWave', assetType: 'STATIC', setId: 'dom' }],
        setIds: ['dom']
      },
      'channel:200': {
        groupId: 'channel:200',
        type: 'channel',
        ownerId: '200',
        login: 'old_user',
        displayName: 'OldUser',
        avatarUrl: '',
        emotes: [
          { id: 'e1', token: 'oldEmote', assetType: 'STATIC', setId: 'set_a' },
          { id: 'e2', token: 'keepEmote', assetType: 'STATIC', setId: 'set_b' }
        ],
        setIds: ['set_a', 'set_b']
      }
    },
    updatedAt: 1000
  };

  const extracted = {
    groups: [
      {
        groupId: 'channel:300',
        type: 'channel',
        ownerId: '300',
        login: 'streamer_b',
        displayName: 'StreamerB',
        avatarUrl: 'https://cdn.example/b.png',
        emotes: [{ id: 'e_gql', token: 'bLove', assetType: 'STATIC', setId: 'set_b1' }],
        setIds: ['set_b1']
      },
      {
        groupId: 'channel:200',
        type: 'channel',
        ownerId: '200',
        login: 'old_user',
        displayName: 'OldUser',
        avatarUrl: '',
        emotes: [{ id: 'e1_new', token: 'newEmote', assetType: 'STATIC', setId: 'set_a' }],
        setIds: ['set_a']
      }
    ],
    ownerProfiles: {
      '200': {
        id: '200',
        login: 'old_user',
        displayName: 'OldUser',
        avatarUrl: 'https://cdn.example/200.png'
      }
    }
  };

  const { catalog, migratedGroupIds } = emoteParser.mergeEmoteCatalog(existingCatalog, extracted);

  assert.equal(migratedGroupIds['channel_login:streamer_b'], 'channel:300');
  assert.equal(catalog.groups['channel_login:streamer_b'], undefined);
  assert.ok(catalog.groups['channel:300']);
  // Authoritative GQL setIds supersede temporary 'dom' emotes
  assert.deepEqual(
    catalog.groups['channel:300'].emotes.map((e) => e.id),
    ['e_gql']
  );

  assert.equal(catalog.groups['channel:200'].avatarUrl, 'https://cdn.example/200.png');
  assert.deepEqual(
    catalog.groups['channel:200'].emotes.map((e) => e.id),
    ['e2', 'e1_new']
  );
});

test('extractChannelLoginFromUrl handles watch, popout, embed, moderator, dashboard, and reserved paths', () => {
  assert.equal(constants.extractChannelLoginFromUrl('https://www.twitch.tv/shroud'), 'shroud');
  assert.equal(
    constants.extractChannelLoginFromUrl('https://www.twitch.tv/popout/Faker/chat?popout='),
    'faker'
  );
  assert.equal(
    constants.extractChannelLoginFromUrl('https://www.twitch.tv/embed/stylishnoob4/chat'),
    'stylishnoob4'
  );
  assert.equal(
    constants.extractChannelLoginFromUrl('https://www.twitch.tv/moderator/jasper7se'),
    'jasper7se'
  );
  assert.equal(
    constants.extractChannelLoginFromUrl('https://dashboard.twitch.tv/u/darumaisgod/stream-manager'),
    'darumaisgod'
  );
  assert.equal(constants.extractChannelLoginFromUrl('https://www.twitch.tv/directory/all'), null);
  assert.equal(constants.extractChannelLoginFromUrl('https://www.twitch.tv/settings/profile'), null);
  assert.equal(constants.extractChannelLoginFromUrl('https://dashboard.twitch.tv/stream-manager'), null);
});

function nativeChannelEmotes(emotes, extra = {}) {
  return { data: { channel: { id: '100', self: { availableEmoteSets: [
    { id: 'followers', owner: { id: '100', login: 'followed' }, emotes }
  ] }, ...extra } } };
}

test('native channel.self.availableEmoteSets restores usable follower emotes missing from an old allowlist', () => {
  const extracted = emoteParser.extractEmotesFromGqlPayload(nativeChannelEmotes([
    { id: 'follower', token: 'FollowHi' }, { id: 'locked', token: 'Locked', isUnlocked: false }
  ], { localEmoteSets: [{ id: 'public', emotes: [{ id: 'notAllowed', token: 'Public' }] }] }), { completeViewerSnapshot: true });
  assert.equal(extracted.completeViewerSnapshot, true);
  const result = emoteParser.mergeEmoteCatalog({ groups: {}, allowedEmoteIds: ['old'] }, extracted).catalog;
  assert.deepEqual(result.groups['channel:100'].emotes.map(e => e.id), ['follower']);
  assert.deepEqual(result.allowedEmoteIds, ['follower']);
});

test('switching to a channel without usable follower emotes removes the previous channel follower set', () => {
  const first = emoteParser.extractEmotesFromGqlPayload(nativeChannelEmotes([{ id: 'follower', token: 'FollowHi' }]), { completeViewerSnapshot: true });
  const catalog = emoteParser.mergeEmoteCatalog(null, first).catalog;
  const next = emoteParser.extractEmotesFromGqlPayload({ data: { channel: { id: '200', self: { availableEmoteSets: [] } } } }, { completeViewerSnapshot: true });
  assert.equal(next.completeViewerSnapshot, true);
  assert.deepEqual(emoteParser.mergeEmoteCatalog(catalog, next).catalog.groups, {});
});

test('partial and failed native channel responses cannot revoke the current usable list', () => {
  for (const payload of [nativeChannelEmotes([]), { ...nativeChannelEmotes([]), errors: [{ message: 'partial' }] }]) {
    const extracted = emoteParser.extractEmotesFromGqlPayload(payload, { completeViewerSnapshot: !payload.errors ? false : true });
    assert.equal(extracted.completeViewerSnapshot, false);
  }
});


test('local follower set metadata restricts usable and cached emotes without granting public catalog access', () => {
  const local = { id: '100', localEmoteSets: [{ id: 'followers', emotes: [{ id: 'follow', token: 'Follow' }] }] };
  const metadata = emoteParser.extractEmotesFromGqlPayload({ data: { channel: local } });
  assert.deepEqual(metadata.groups, []);
  assert.deepEqual(metadata.channelOnlyEmotes, { follow: '100' });
  const cached = { groups: { 'channel:100': { groupId: 'channel:100', type: 'channel', emotes: [{ id: 'follow', token: 'Follow' }, { id: 'sub', token: 'Sub' }] } } };
  const result = emoteParser.mergeEmoteCatalog(cached, metadata).catalog;
  assert.equal(result.groups['channel:100'].emotes[0].channelOnlyId, '100');
  assert.equal(result.groups['channel:100'].emotes[1].channelOnlyId, undefined);
  assert.equal(cached.groups['channel:100'].emotes[0].channelOnlyId, undefined);
  const refreshed = emoteParser.mergeEmoteCatalog(result, { completeViewerSnapshot: true, groups: [] }).catalog;
  assert.deepEqual(refreshed.groups, {});
  assert.deepEqual(refreshed.channelOnlyEmotes, { follow: '100' });
});
