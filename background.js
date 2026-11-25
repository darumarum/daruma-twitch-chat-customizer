'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'TCC_OPEN_OPTIONS') {
    return false;
  }

  const hash = msg.tab ? '#' + String(msg.tab).replace(/^#/, '') : '';
  const targetUrl = chrome.runtime.getURL('options/options.html' + hash);

  if (chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: targetUrl }, () => {
      if (chrome.runtime.lastError && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage(() => sendResponse({ ok: true }));
    return true;
  }

  sendResponse({ ok: false });
  return false;
});

// Local development only. No server, additional permissions or OS watcher is
// needed: read our own unpacked assets and reload after a stable change.
(() => {
  const key = 'tcc_dev_reload';
  const matches = ['https://www.twitch.tv/*', 'https://dashboard.twitch.tv/*'];
  const isTwitch = url => /^https:\/\/(?:www|dashboard)\.twitch\.tv\//.test(url || '');
  let checking = null;
  let lastCheck = 0;
  let candidate = '';
  let candidateAt = 0;
  let reloading = false;
  const ready = (async () => {
    const saved = (await chrome.storage.local.get(key))[key] || {};
    if (saved.tabs) {
      await chrome.storage.local.set({ [key]: { fingerprint: saved.fingerprint } });
      await Promise.allSettled(saved.tabs.map(async previous => {
        const tab = await chrome.tabs.get(previous.id);
        if (isTwitch(tab.url) && tab.url === previous.url) await chrome.tabs.reload(tab.id);
      }));
    }
  })();
  async function fingerprint() {
    const response = await fetch(chrome.runtime.getURL('dev-autoreload.json'), { cache: 'no-store' });
    if (!response.ok) return null;
    const config = await response.json();
    if (config.enabled !== true || !Array.isArray(config.files) || config.files.length > 100) return null;
    const paths = config.files.filter(path => typeof path === 'string' && !path.includes('..') && /^[a-z0-9_./-]+\.(js|css|html|json)$/i.test(path));
    const sources = await Promise.all(paths.map(async path => {
      const asset = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
      if (!asset.ok) throw new Error('Development asset unavailable');
      return path + '\n' + await asset.text();
    }));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(config) + sources.join('\0')));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function check() {
    await ready;
    const hash = await fingerprint();
    if (!hash) return { enabled: false };
    const saved = (await chrome.storage.local.get(key))[key] || {};
    if (!saved.fingerprint) {
      await chrome.storage.local.set({ [key]: { fingerprint: hash } });
      return { enabled: true, fingerprint: hash };
    }
    if (saved.fingerprint === hash) { candidate = ''; return { enabled: true, fingerprint: hash }; }
    if (candidate !== hash) { candidate = hash; candidateAt = Date.now(); }
    if (Date.now() - candidateAt < 1000) return { enabled: true, fingerprint: saved.fingerprint };
    const tabs = await chrome.tabs.query({ url: matches });
    const targets = [];
    for (const tab of tabs) {
      try {
        const status = await chrome.tabs.sendMessage(tab.id, { type: 'TCC_DEV_RELOAD_STATUS' }, { frameId: 0 });
        if (status?.safe === false) return { enabled: true, fingerprint: saved.fingerprint, waiting: true };
        if (status?.safe === true) targets.push({ id: tab.id, url: tab.url });
      } catch (_) { /* Old/unloaded pages are refreshed on their next navigation. */ }
    }
    if (!targets.length) return { enabled: true, fingerprint: saved.fingerprint };
    await chrome.storage.local.set({ [key]: { fingerprint: hash, tabs: targets } });
    reloading = true;
    setTimeout(() => chrome.runtime.reload(), 50);
    return { enabled: true, fingerprint: hash, reloading: true };
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'TCC_DEV_RELOAD_POLL' || sender.id !== chrome.runtime.id || !isTwitch(sender.tab?.url)) return false;
    if (reloading) { reply({ reloading: true }); return false; }
    if (!checking && Date.now() - lastCheck >= 1000) {
      lastCheck = Date.now();
      checking = check().catch(() => ({ enabled: false })).finally(() => { checking = null; });
    }
    if (!checking) { reply({}); return false; }
    checking.then(reply);
    return true;
  });
})();
