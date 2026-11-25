(function (root, factory) {
  const api = factory();
  root.TCC = root.TCC || {};
  root.TCC.constants = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BRIDGE_CHANNEL = 'TCC_BRIDGE_V1';

  const STORAGE_KEYS = Object.freeze({
    SETTINGS: 'tcc_settings',
    CATALOG: 'tcc_catalog',
    FAVORITES: 'tcc_favorites',
    GROUP_ORDER: 'tcc_group_order',
    COLLAPSED_GROUPS: 'tcc_collapsed_groups'
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    chatEnabled: true,
    width: Object.freeze({
      enabled: true,
      chatWidthUnit: 'px',
      chatWidthPx: 340,
      chatWidthPct: 22,
      showResizeHandle: true
    }),
    picker: Object.freeze({
      enabled: true,
      keepOpenOnSelect: true,
      emoteSize: 'medium',
      pinCurrentChannel: true,
      pickerWidthUnit: 'px',
      pickerWidthPx: 680,
      pickerWidthPct: 38,
      pickerHeightPx: 600
    }),
    rewards: Object.freeze({
      enabled: true,
      oneClickRedeem: true,
      autoCloseOnRedeem: true,
      precheckAvailability: true,
      itemSize: 'medium',
      widthUnit: 'px',
      widthPx: 340,
      widthPct: 22,
      heightPx: 540
    })
  });

  const RESERVED_TWITCH_PATHS = new Set([
    'directory',
    'videos',
    'settings',
    'subscriptions',
    'drops',
    'inventory',
    'wallet',
    'search',
    'u',
    'popout',
    'embed',
    'moderator',
    'downloads',
    'jobs',
    'turbo',
    'prime',
    'friends',
    'messages',
    'payments',
    'store',
    'p',
    'team',
    'following',
    'browse',
    'clips',
    'schedule',
    'about',
    'chat',
    'login',
    'signup',
    'activate',
    'products',
    'security',
    'privacy',
    'terms',
    'bits',
    'creatorcamp',
    'broadcast',
    'dashboard',
    'stream-manager',
    'home',
    'activity',
    'analytics',
    'community',
    'content',
    'extensions',
    'monetization',
    'viewer-rewards',
    'alerts'
  ]);

  const EMOTE_SIZE_PX = Object.freeze({
    small: 28,
    medium: 34,
    large: 44
  });

  function isPlainObject(val) {
    return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
  }

  function deepMergeSettings(base, override) {
    const result = {};
    const baseObj = isPlainObject(base) ? base : {};
    const overObj = isPlainObject(override) ? override : {};

    for (const key of Object.keys(baseObj)) {
      const bVal = baseObj[key];
      const oVal = Object.prototype.hasOwnProperty.call(overObj, key) ? overObj[key] : undefined;
      if (isPlainObject(bVal)) {
        result[key] = deepMergeSettings(bVal, isPlainObject(oVal) ? oVal : {});
      } else if (oVal !== undefined) {
        result[key] = Array.isArray(oVal) ? oVal.slice() : oVal;
      } else {
        result[key] = Array.isArray(bVal) ? bVal.slice() : bVal;
      }
    }

    for (const key of Object.keys(overObj)) {
      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        const oVal = overObj[key];
        result[key] = isPlainObject(oVal)
          ? deepMergeSettings({}, oVal)
          : Array.isArray(oVal)
            ? oVal.slice()
            : oVal;
      }
    }
    return result;
  }

  function getEmoteImageUrl(id, theme = 'dark', scale = '2.0') {
    if (!id) return '';
    const safeTheme = theme === 'light' ? 'light' : 'dark';
    const safeScale = scale || '2.0';
    return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(String(id))}/default/${safeTheme}/${safeScale}`;
  }

  function normalizeLogin(candidate) {
    if (typeof candidate !== 'string') return null;
    const cleaned = candidate.trim().toLowerCase();
    if (!cleaned || RESERVED_TWITCH_PATHS.has(cleaned)) return null;
    if (!/^[a-z0-9_]{1,30}$/.test(cleaned)) return null;
    return cleaned;
  }

  function extractChannelLoginFromUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') return null;
    let url;
    try {
      url = new URL(urlString);
    } catch (_) {
      return null;
    }

    const host = url.hostname.toLowerCase();
    if (host !== 'www.twitch.tv' && host !== 'twitch.tv' && host !== 'dashboard.twitch.tv') {
      return null;
    }

    const segments = url.pathname
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length === 0) return null;

    const first = segments[0].toLowerCase();

    // dashboard.twitch.tv/u/<login>/... or www.twitch.tv/u/<login>
    if (first === 'u' && segments.length >= 2) {
      return normalizeLogin(segments[1]);
    }

    // www.twitch.tv/popout/<login>/chat or /embed/<login>/chat or /moderator/<login>
    if ((first === 'popout' || first === 'embed' || first === 'moderator') && segments.length >= 2) {
      return normalizeLogin(segments[1]);
    }

    // dashboard.twitch.tv/<something> without /u/<login> usually doesn't contain login in path
    if (host === 'dashboard.twitch.tv') {
      const qChannel = url.searchParams.get('channel');
      return normalizeLogin(qChannel);
    }

    return normalizeLogin(segments[0]);
  }

  function clampChatWidthPx(px) {
    const num = Number(px);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.width.chatWidthPx;
    return Math.min(800, Math.max(240, Math.round(num)));
  }

  function clampPickerWidthPx(px) {
    const num = Number(px);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.picker.pickerWidthPx;
    return Math.min(1200, Math.max(320, Math.round(num)));
  }

  function clampPickerHeight(px) {
    const num = Number(px);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.picker.pickerHeightPx;
    return Math.min(850, Math.max(360, Math.round(num)));
  }

  function normalizeWidthUnit(unit) {
    return unit === '%' ? '%' : 'px';
  }

  function clampChatWidthPct(pct) {
    const num = Number(pct);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.width.chatWidthPct;
    return Math.min(50, Math.max(12, Math.round(num * 100) / 100));
  }

  function clampPickerWidthPct(pct) {
    const num = Number(pct);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.picker.pickerWidthPct;
    return Math.min(85, Math.max(1, Math.round(num * 100) / 100));
  }

  function clampRewardsWidthPx(px) {
    const num = Number(px);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.rewards.widthPx;
    return Math.min(900, Math.max(280, Math.round(num)));
  }

  function clampRewardsWidthPct(pct) {
    const num = Number(pct);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.rewards.widthPct;
    return Math.min(75, Math.max(15, Math.round(num * 100) / 100));
  }

  function clampRewardsHeightPx(px) {
    const num = Number(px);
    if (!Number.isFinite(num)) return DEFAULT_SETTINGS.rewards.heightPx;
    return Math.min(850, Math.max(300, Math.round(num)));
  }

  function validViewportWidth(viewportWidth) {
    return Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1280;
  }

  function resolveChatWidthPx(widthSettings, viewportWidth) {
    const w = widthSettings || DEFAULT_SETTINGS.width;
    const vw = validViewportWidth(viewportWidth);
    const maxAllowed = Math.max(240, vw - 320);
    const rawPx = normalizeWidthUnit(w.chatWidthUnit) === '%'
      ? Math.max(240, Math.round((clampChatWidthPct(w.chatWidthPct) / 100) * vw))
      : clampChatWidthPx(w.chatWidthPx);
    return Math.min(rawPx, maxAllowed);
  }

  function resolvePickerWidthPx(pickerSettings, viewportWidth) {
    const p = pickerSettings || DEFAULT_SETTINGS.picker;
    const vw = validViewportWidth(viewportWidth);
    const maxAllowed = Math.max(260, vw - 16);
    const rawPx = normalizeWidthUnit(p.pickerWidthUnit) === '%'
      ? Math.max(280, Math.round((clampPickerWidthPct(p.pickerWidthPct) / 100) * vw))
      : Math.max(280, clampPickerWidthPx(p.pickerWidthPx));
    return Math.min(rawPx, maxAllowed);
  }

  function resolveRewardsWidthPx(rewardsSettings, viewportWidth) {
    const r = rewardsSettings || DEFAULT_SETTINGS.rewards;
    const vw = validViewportWidth(viewportWidth);
    const maxAllowed = Math.max(280, vw - 16);
    const rawPx = normalizeWidthUnit(r.widthUnit) === '%'
      ? Math.max(280, Math.round((clampRewardsWidthPct(r.widthPct) / 100) * vw))
      : clampRewardsWidthPx(r.widthPx);
    return Math.min(rawPx, maxAllowed);
  }

  return {
    BRIDGE_CHANNEL,
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    RESERVED_TWITCH_PATHS,
    EMOTE_SIZE_PX,
    deepMergeSettings,
    getEmoteImageUrl,
    extractChannelLoginFromUrl,
    normalizeWidthUnit,
    clampChatWidthPx,
    clampChatWidthPct,
    clampPickerWidthPx,
    clampPickerWidthPct,
    clampPickerHeight,
    clampRewardsWidthPx,
    clampRewardsWidthPct,
    clampRewardsHeightPx,
    resolveChatWidthPx,
    resolvePickerWidthPx,
    resolveRewardsWidthPx
  };
});
