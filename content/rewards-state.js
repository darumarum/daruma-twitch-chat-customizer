/* Read only the state associated with Twitch's native reward controls. */
(() => {
  'use strict';
  const fields = /^(id|__typename|title|cost|is\w+|canRedeem|balance|\w*[Rr]edemptions\w*|\w*[Cc]ooldown\w*|maxPer\w+|globalCooldown\w+|updatedAt)$/;
  function clean(value, depth = 0) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (depth > 3 || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = {};
    for (const key of Object.keys(value)) {
      if (fields.test(key) || key === 'currentUser') {
        const next = clean(value[key], depth + 1);
        if (next !== undefined) result[key] = next;
      }
    }
    return result;
  }
  function nativeState(element) {
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    let fiber = key && element[key];
    const state = {};
    for (let i = 0; i < 30 && fiber; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== 'object') continue;
      const selected = Array.isArray(props.data) ? props.data[props.index] : props.data;
      for (const candidate of [props.reward, props.customReward, selected, selected?.reward, selected?.customReward, selected?.node]) {
        if (!state.reward && candidate?.id && candidate?.title) state.reward = clean(candidate);
      }
      for (const name of ['balance', 'isAffordable', 'isAvailable', 'isRedeemable', 'canRedeem', 'isUserRedemptionLimitReached', 'isMaxPerStreamReached']) {
        if (state[name] === undefined && ['number', 'boolean'].includes(typeof props[name])) state[name] = props[name];
      }
      for (const name of ['isChannelLive', 'isLive']) {
        if (state.channelOffline === undefined && typeof props[name] === 'boolean') state.channelOffline = !props[name];
      }
    }
    return state;
  }
  function redemptionResult(payload) {
    const result = payload?.data?.redeemCommunityPoints;
    if (payload?.errors?.length || result?.error) return 'error';
    return result?.redemption?.id ? 'success' : 'unknown';
  }
  function userRedemptions(payload) {
    const result = [];
    let count = 0;
    function visit(node, viewerScope = false, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 16 || ++count > 5000) return;
      if (viewerScope && typeof node.rewardID === 'string' && Number.isFinite(node.redemptionsRedeemedCurrentStream)) {
        result.push({ rewardId: node.rewardID, count: node.redemptionsRedeemedCurrentStream });
      }
      for (const key of Object.keys(node)) visit(node[key], viewerScope || key === 'userRedemptions', depth + 1);
    }
    visit(payload);
    return result;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { clean, nativeState, redemptionResult, userRedemptions };
    return;
  }
  let queued = false;
  function update() {
    queued = false;
    document.querySelectorAll('[class*="rewardListItem--"]').forEach(item => {
      if (item.closest?.('.tcc-rewards-snapshot')) return;
      const button = item.querySelector('button:not(.tcc-redeem)');
      if (!button) return;
      const state = JSON.stringify(nativeState(button));
      if (item.dataset.tccRewardState !== state) item.dataset.tccRewardState = state;
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }, { once: true });
  let sequence = 0;
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let operations = [];
    let isGql = false;
    try {
      const url = typeof input === 'string' ? input : input?.url;
      isGql = Boolean(url && new URL(url, location.href).hostname === 'gql.twitch.tv');
      if (isGql && typeof init?.body === 'string') {
        const body = JSON.parse(init.body);
        operations = (Array.isArray(body) ? body : [body]).map((op, index) => ({ op, index }))
          .filter(({ op }) => /redeemcommunitypoints/i.test(op.operationName || ''))
          .map(({ op, index }) => ({ index, rewardId: op.variables?.input?.rewardID, requestId: ++sequence }));
      }
    } catch (_) {}
    const post = (operation, status) => window.postMessage({ channel: 'TCC_REWARDS_V1', ...operation, status }, '*');
    operations.forEach(op => post(op, 'start'));
    const promise = originalFetch.apply(this, arguments);
    if (isGql) promise.then(async response => {
      try {
        const data = await response.clone().json();
        const counts = userRedemptions(data);
        if (counts.length) window.postMessage({ channel: 'TCC_REWARDS_V1', status: 'counts', counts }, '*');
        operations.forEach(op => post(op, response.ok ? redemptionResult(Array.isArray(data) ? data[op.index] : data) : 'error'));
      } catch (_) { operations.forEach(op => post(op, 'error')); }
    }, () => operations.forEach(op => post(op, 'error')));
    return promise;
  };
})();
