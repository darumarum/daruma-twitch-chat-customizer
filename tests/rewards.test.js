const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeDisabled, resolveRewardsConfig } = require('../content/rewards.js');
const { clean, nativeState, redemptionResult, userRedemptions } = require('../content/rewards-state.js');
const fs = require('node:fs');
const vm = require('node:vm');

test('native disabled and aria-disabled flags are used verbatim', () => {
  assert.equal(nativeDisabled({ disabled: true, getAttribute: () => null }), true);
  assert.equal(nativeDisabled({ disabled: false, getAttribute: () => 'true' }), true);
  assert.equal(nativeDisabled({ disabled: false, getAttribute: () => null }), false);
  assert.equal(nativeDisabled(null), true);
});

test('only confirmed redemption IDs count as success', () => {
  assert.equal(redemptionResult({ data: { redeemCommunityPoints: { redemption: { id: 'receipt' } } } }), 'success');
  assert.equal(redemptionResult({ data: { redeemCommunityPoints: { redemption: null } } }), 'unknown');
  assert.equal(redemptionResult({ data: { redeemCommunityPoints: { error: { code: 'LIMIT' } } } }), 'error');
  assert.equal(redemptionResult({ errors: [{ message: 'denied' }] }), 'error');
});
test('native state preserves limits and excludes unrelated account data', () => {
  const reward = { id: 'reward', title: 'Reward', cost: 10,
    maxPerUserPerStreamSetting: { isEnabled: true, maxPerUserPerStream: 1 },
    currentUser: { redemptionsRedeemedCurrentStream: 1, email: 'private' }, authToken: 'secret' };
  const state = nativeState({ __reactFiber$test: { memoizedProps: { reward, balance: 20 }, return: null } });
  assert.equal(state.reward.maxPerUserPerStreamSetting.maxPerUserPerStream, 1);
  assert.equal(JSON.stringify(state).includes('private'), false);
  assert.equal(JSON.stringify(clean(reward)).includes('secret'), false);
});
test('virtual list data and index resolve the selected reward', () => {
  const reward = { id: 'one', title: 'Reward', cost: 10, currentUserRedemptionsRedeemedCurrentStream: 1,
    maxPerUserPerStreamSetting: { isEnabled: true, maxPerUserPerStream: 1 } };
  const state = nativeState({ __reactFiber$test: { memoizedProps: { data: [reward], index: 0 } } });
  assert.equal(state.reward.id, 'one');
  assert.equal(state.reward.maxPerUserPerStreamSetting.maxPerUserPerStream, 1);
});
test('viewer limits use user redemptions, never the channel total', () => {
  const entries = userRedemptions({ data: { community: { self: { communityPoints: { userRedemptions: [
    { rewardID: 'one', redemptionsRedeemedCurrentStream: 2 }
  ] } }, reward: { rewardID: 'two', redemptionsRedeemedCurrentStream: 99 } } } });
  assert.deepEqual(entries, [{ rewardId: 'one', count: 2 }]);
});
test('passive fetch tracking correlates a batched redemption without changing the response', async () => {
  const messages = [];
  const response = { ok: true, clone: () => ({ json: async () => [{ data: {} },
    { data: { redeemCommunityPoints: { redemption: { id: 'receipt' } } } }] }) };
  const window = { fetch: () => Promise.resolve(response), postMessage: message => messages.push(message) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../content/rewards-state.js'), 'utf8'), {
    window, document: { addEventListener() {} }, location: { href: 'https://www.twitch.tv/darumarum' }, URL
  });
  const result = await window.fetch('https://gql.twitch.tv/gql', { body: JSON.stringify([
    { operationName: 'Other' }, { operationName: 'RedeemCommunityPoints', variables: { input: { rewardID: 'reward' } } }
  ]) });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(result, response);
  assert.deepEqual(messages.map(message => message.status), ['start', 'success']);
  assert.equal(messages[0].requestId, messages[1].requestId);
  assert.equal(messages[1].rewardId, 'reward');
});

test('resolveRewardsConfig enforces dependencies cleanly and validates itemSize and dimensions', () => {
  assert.deepEqual(resolveRewardsConfig(), {
    enabled: true,
    compactList: true,
    oneClickRedeem: true,
    precheckAvailability: true,
    autoCloseOnRedeem: true,
    hideAllTab: true,
    disableAnimation: true,
    itemSize: 'medium',
    widthUnit: 'px',
    widthPx: 340,
    widthPct: 22,
    heightPx: 540
  });

  const masterOff = resolveRewardsConfig({ enabled: false, rewards: { enabled: true } });
  assert.equal(masterOff.enabled, false);
  assert.equal(masterOff.compactList, false);
  assert.equal(masterOff.autoCloseOnRedeem, false);
  assert.equal(masterOff.hideAllTab, false);
  assert.equal(masterOff.disableAnimation, false);

  const rewardsOff = resolveRewardsConfig({ enabled: true, rewards: { enabled: false } });
  assert.equal(rewardsOff.enabled, false);
  assert.equal(rewardsOff.precheckAvailability, false);

  const compactLegacy = resolveRewardsConfig({
    rewards: { compactList: false, hideAllTab: false, disableAnimation: false, oneClickRedeem: true, precheckAvailability: true }
  });
  assert.equal(compactLegacy.enabled, true);
  assert.equal(compactLegacy.compactList, true);
  assert.equal(compactLegacy.hideAllTab, true);
  assert.equal(compactLegacy.disableAnimation, true);
  assert.equal(compactLegacy.oneClickRedeem, true);
  assert.equal(compactLegacy.precheckAvailability, true);

  const oneClickOff = resolveRewardsConfig({
    rewards: { oneClickRedeem: false, precheckAvailability: true }
  });
  assert.equal(oneClickOff.compactList, true);
  assert.equal(oneClickOff.oneClickRedeem, false);
  assert.equal(oneClickOff.precheckAvailability, false);

  assert.equal(resolveRewardsConfig({ rewards: { itemSize: 'small' } }).itemSize, 'small');
  assert.equal(resolveRewardsConfig({ rewards: { itemSize: 'large' } }).itemSize, 'large');
  assert.equal(resolveRewardsConfig({ rewards: { itemSize: 'invalid' } }).itemSize, 'medium');

  const sized = resolveRewardsConfig({ rewards: { widthUnit: '%', widthPx: 520, widthPct: 35, heightPx: 680 } });
  assert.equal(sized.widthUnit, '%');
  assert.equal(sized.widthPx, 520);
  assert.equal(sized.widthPct, 35);
  assert.equal(sized.heightPx, 680);
  const clamped = resolveRewardsConfig({ rewards: { widthUnit: 'invalid', widthPx: 100, widthPct: 5, heightPx: 9999 } });
  assert.equal(clamped.widthUnit, 'px');
  assert.equal(clamped.widthPx, 280);
  assert.equal(clamped.widthPct, 15);
  assert.equal(clamped.heightPx, 850);
});




test('native state updates preserve the metadata copied into a reward snapshot', () => {
  const state = JSON.stringify({reward:{id:'reward',title:'Reward',isUserInputRequired:false}});
  const button = {__reactFiber$test:{memoizedProps:{reward:{id:'reward',title:'Reward',isUserInputRequired:false}},return:null}};
  const native = {dataset:{},closest:()=>null,querySelector:()=>button};
  const copy = {dataset:{tccRewardState:state},closest:()=>({}),querySelector:()=>({})};
  let ready;
  const frames=[];
  vm.runInNewContext(fs.readFileSync(require.resolve('../content/rewards-state.js'),'utf8'), {
    document:{body:{},addEventListener(type,fn){if(type==='DOMContentLoaded') ready=fn;},querySelectorAll:()=>[native,copy]},
    window:{fetch(){}},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>frames.push(fn)
  });
  ready();
  frames.shift()();
  assert.equal(JSON.parse(native.dataset.tccRewardState).reward.isUserInputRequired,false);
  assert.equal(copy.dataset.tccRewardState,state);
});
