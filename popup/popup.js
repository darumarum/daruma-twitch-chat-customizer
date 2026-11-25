(function () {
  'use strict';

  const { constants, storage } = globalThis.TCC || {};
  if (!constants || !storage) return;

  const {
    DEFAULT_SETTINGS,
    deepMergeSettings,
    normalizeWidthUnit,
    clampChatWidthPx,
    clampChatWidthPct,
    clampPickerWidthPx,
    clampPickerWidthPct,
    clampPickerHeight,
    clampRewardsWidthPx,
    clampRewardsWidthPct,
    clampRewardsHeightPx
  } = constants;

  const TAB_STORAGE_KEY = 'tcc_popup_active_tab';

  const els = {
    extVersion: document.getElementById('ext-version'),
    dotChat: document.getElementById('dot-chat'),
    dotPicker: document.getElementById('dot-picker'),
    dotRewards: document.getElementById('dot-rewards'),
    enabled: document.getElementById('opt-enabled'),
    chatEnabled: document.getElementById('opt-chatEnabled'),
    pickerEnabled: document.getElementById('opt-pickerEnabled'),
    rewardsEnabled: document.getElementById('opt-rewardsEnabled'),
    chatControls: document.getElementById('chat-controls'),
    pickerControls: document.getElementById('picker-controls'),
    rewardsControls: document.getElementById('rewards-controls'),
    chatWidthUnit: document.getElementById('opt-chatWidthUnit'),
    chatWidthPx: document.getElementById('opt-chatWidthPx'),
    valChatWidthPx: document.getElementById('val-chatWidthPx'),
    btnResetWidth: document.getElementById('btn-reset-width'),
    showResizeHandle: document.getElementById('opt-showResizeHandle'),
    keepOpenOnSelect: document.getElementById('opt-keepOpenOnSelect'),
    pinCurrentChannel: document.getElementById('opt-pinCurrentChannel'),
    emoteSize: document.getElementById('opt-emoteSize'),
    pickerWidthUnit: document.getElementById('opt-pickerWidthUnit'),
    pickerWidthPx: document.getElementById('opt-pickerWidthPx'),
    valPickerWidthPx: document.getElementById('val-pickerWidthPx'),
    pickerHeightPx: document.getElementById('opt-pickerHeightPx'),
    valPickerHeightPx: document.getElementById('val-pickerHeightPx'),
    rewardsOneClickRedeem: document.getElementById('opt-rewardsOneClickRedeem'),
    rewardsPrecheckAvailability: document.getElementById('opt-rewardsPrecheckAvailability'),
    rowRewardsPrecheckAvailability: document.getElementById('row-rewardsPrecheckAvailability'),
    rewardsItemSize: document.getElementById('opt-rewardsItemSize'),
    rewardsWidthUnit: document.getElementById('opt-rewardsWidthUnit'),
    rewardsWidthPx: document.getElementById('opt-rewardsWidthPx'),
    valRewardsWidthPx: document.getElementById('val-rewardsWidthPx'),
    rewardsHeightPx: document.getElementById('opt-rewardsHeightPx'),
    valRewardsHeightPx: document.getElementById('val-rewardsHeightPx'),
    rewardsAutoCloseOnRedeem: document.getElementById('opt-rewardsAutoCloseOnRedeem'),
    statGroups: document.getElementById('stat-groups'),
    statEmotes: document.getElementById('stat-emotes'),
    statFavorites: document.getElementById('stat-favorites'),
    btnOpenOptions: document.getElementById('btn-open-options'),
    btnSyncTab: document.getElementById('btn-sync-tab'),
    btnExport: document.getElementById('btn-export'),
    inputImport: document.getElementById('input-import'),
    btnClearCatalog: document.getElementById('btn-clear-catalog'),
    btnResetSettings: document.getElementById('btn-reset-settings'),
    statusMsg: document.getElementById('status-msg')
  };

  let latestSettings = DEFAULT_SETTINGS;
  let activeTabId = null;
  let queuedPreviewPatch = null;
  let queuedPreviewOpenPicker = null;
  let previewRaf = null;
  let activeSliderId = null;
  let pendingSliderPatch = null;

  const WIDTH_RANGES = {
    width: { px: { min: 240, max: 800, step: 1 }, pct: { min: 12, max: 50, step: 0.01 } },
    picker: { px: { min: 320, max: 1200, step: 1 }, pct: { min: 1, max: 85, step: 0.01 } },
    rewards: { px: { min: 280, max: 900, step: 1 }, pct: { min: 15, max: 75, step: 0.01 } }
  };

  function resolveActiveTabId(callback) {
    if (activeTabId != null) {
      callback(activeTabId);
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      callback(null);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        callback(null);
        return;
      }
      const tab = tabs && tabs[0];
      if (tab && tab.id != null) {
        activeTabId = tab.id;
      }
      callback(activeTabId);
    });
  }

  function sendPreviewMessage(tabId, patch, openPicker) {
    if (tabId == null || typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.sendMessage) return;
    chrome.tabs.sendMessage(
      tabId,
      { type: 'TCC_PREVIEW_SETTINGS', patch, openPicker },
      () => {
        void (chrome.runtime && chrome.runtime.lastError);
      }
    );
  }

  function flushPreview() {
    previewRaf = null;
    const patch = queuedPreviewPatch;
    const openPicker = queuedPreviewOpenPicker;
    queuedPreviewPatch = null;
    queuedPreviewOpenPicker = null;
    if (!patch && !openPicker) return;
    resolveActiveTabId((tabId) => {
      sendPreviewMessage(tabId, patch, openPicker);
    });
  }

  function queuePreview(patch, openPicker = null) {
    if (patch) {
      queuedPreviewPatch = queuedPreviewPatch
        ? deepMergeSettings(queuedPreviewPatch, patch)
        : deepMergeSettings({}, patch);
    }
    if (openPicker) {
      queuedPreviewOpenPicker = openPicker;
    }
    if (previewRaf === null) {
      if (typeof requestAnimationFrame === 'function') {
        previewRaf = requestAnimationFrame(flushPreview);
      } else {
        flushPreview();
      }
    }
  }

  function recordPendingSliderPatch(section, key, val) {
    const patch = { [section]: { [key]: val } };
    pendingSliderPatch = pendingSliderPatch
      ? deepMergeSettings(pendingSliderPatch, patch)
      : patch;
  }

  function clearPendingSliderKey(section, key) {
    if (!pendingSliderPatch || !pendingSliderPatch[section]) return;
    delete pendingSliderPatch[section][key];
    if (Object.keys(pendingSliderPatch[section]).length === 0) {
      delete pendingSliderPatch[section];
    }
    if (Object.keys(pendingSliderPatch).length === 0) {
      pendingSliderPatch = null;
    }
  }

  function flushPendingSliderSave() {
    if (!pendingSliderPatch) return;
    const patch = pendingSliderPatch;
    pendingSliderPatch = null;
    storage.saveSettings(patch);
  }

  function syncUnitToggleUI(groupEl, unit) {
    if (!groupEl) return;
    Array.from(groupEl.querySelectorAll('[data-unit]')).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.unit === unit));
    });
  }

  function applyDualUnitSliderUI({ sliderEl, badgeEl, unitGroupEl, unit, val, range }) {
    syncUnitToggleUI(unitGroupEl, unit);
    if (activeSliderId !== sliderEl.id) {
      sliderEl.min = String(range.min);
      sliderEl.max = String(range.max);
      sliderEl.step = String(range.step);
      sliderEl.value = String(val);
      badgeEl.textContent = `${val}${unit}`;
    }
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

  function updateTabDot(dotEl, isOn, isActive) {
    if (!dotEl) return;
    dotEl.classList.toggle('is-on', Boolean(isOn));
    dotEl.classList.toggle('is-paused', !isActive);
  }

  let statusTimer = null;
  function setStatus(msg) {
    if (!els.statusMsg) return;
    els.statusMsg.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      els.statusMsg.textContent = '';
    }, 3000);
  }

  function renderStats(state) {
    const groups = (state.catalog && state.catalog.groups) || {};
    const groupList = Object.values(groups).filter((g) => g && Array.isArray(g.emotes) && g.emotes.length > 0);
    const totalEmotes = groupList.reduce((acc, g) => acc + g.emotes.length, 0);

    els.statGroups.textContent = String(groupList.filter(group => group.type !== 'global').length);
    els.statEmotes.textContent = String(totalEmotes);
    els.statFavorites.textContent = String((state.favorites || []).length);
  }

  function renderSettings(settings) {
    latestSettings = deepMergeSettings(DEFAULT_SETTINGS, settings || {});
    const width = latestSettings.width;
    const picker = latestSettings.picker;
    const rewards = latestSettings.rewards;
    const chatOn = latestSettings.chatEnabled !== false && width.enabled !== false;

    els.enabled.checked = Boolean(latestSettings.enabled);
    els.chatEnabled.checked = chatOn;
    els.pickerEnabled.checked = picker.enabled !== false;
    els.rewardsEnabled.checked = rewards.enabled !== false;

    const chatUnit = normalizeWidthUnit(width.chatWidthUnit);
    applyDualUnitSliderUI({
      sliderEl: els.chatWidthPx,
      badgeEl: els.valChatWidthPx,
      unitGroupEl: els.chatWidthUnit,
      unit: chatUnit,
      val: chatUnit === '%' ? clampChatWidthPct(width.chatWidthPct) : clampChatWidthPx(width.chatWidthPx),
      range: chatUnit === '%' ? WIDTH_RANGES.width.pct : WIDTH_RANGES.width.px
    });
    els.showResizeHandle.checked = Boolean(width.showResizeHandle);

    els.keepOpenOnSelect.checked = Boolean(picker.keepOpenOnSelect);
    els.pinCurrentChannel.checked = picker.pinCurrentChannel !== false;
    els.emoteSize.value = picker.emoteSize || 'medium';

    const pickerUnit = normalizeWidthUnit(picker.pickerWidthUnit);
    applyDualUnitSliderUI({
      sliderEl: els.pickerWidthPx,
      badgeEl: els.valPickerWidthPx,
      unitGroupEl: els.pickerWidthUnit,
      unit: pickerUnit,
      val: pickerUnit === '%' ? clampPickerWidthPct(picker.pickerWidthPct) : clampPickerWidthPx(picker.pickerWidthPx),
      range: pickerUnit === '%' ? WIDTH_RANGES.picker.pct : WIDTH_RANGES.picker.px
    });

    if (activeSliderId !== els.pickerHeightPx.id) {
      const pHeight = clampPickerHeight(picker.pickerHeightPx);
      els.pickerHeightPx.value = String(pHeight);
      els.valPickerHeightPx.textContent = `${pHeight}px`;
    }

    els.rewardsOneClickRedeem.checked = rewards.oneClickRedeem !== false;
    els.rewardsPrecheckAvailability.checked = rewards.precheckAvailability !== false;
    els.rewardsAutoCloseOnRedeem.checked = rewards.autoCloseOnRedeem !== false;
    els.rewardsItemSize.value =
      rewards.itemSize === 'small' || rewards.itemSize === 'large' ? rewards.itemSize : 'medium';

    const rewardsUnit = normalizeWidthUnit(rewards.widthUnit);
    applyDualUnitSliderUI({
      sliderEl: els.rewardsWidthPx,
      badgeEl: els.valRewardsWidthPx,
      unitGroupEl: els.rewardsWidthUnit,
      unit: rewardsUnit,
      val: rewardsUnit === '%' ? clampRewardsWidthPct(rewards.widthPct) : clampRewardsWidthPx(rewards.widthPx),
      range: rewardsUnit === '%' ? WIDTH_RANGES.rewards.pct : WIDTH_RANGES.rewards.px
    });

    if (activeSliderId !== els.rewardsHeightPx.id) {
      const rHeightPx = clampRewardsHeightPx(rewards.heightPx);
      els.rewardsHeightPx.value = String(rHeightPx);
      els.valRewardsHeightPx.textContent = `${rHeightPx}px`;
    }

    const active = latestSettings.enabled !== false;
    const pickerOn = picker.enabled !== false;
    const rewardsOn = rewards.enabled !== false;
    const oneClickOn = rewards.oneClickRedeem !== false;

    els.chatEnabled.disabled = !active;
    els.pickerEnabled.disabled = !active;
    els.rewardsEnabled.disabled = !active;
    els.chatEnabled.closest('.switch')?.classList.toggle('is-disabled', !active);
    els.pickerEnabled.closest('.switch')?.classList.toggle('is-disabled', !active);
    els.rewardsEnabled.closest('.switch')?.classList.toggle('is-disabled', !active);

    els.chatControls.disabled = !active || !chatOn;
    els.pickerControls.disabled = !active || !pickerOn;
    els.rewardsControls.disabled = !active || !rewardsOn;

    els.rewardsPrecheckAvailability.disabled = !oneClickOn;
    if (els.rowRewardsPrecheckAvailability) {
      els.rowRewardsPrecheckAvailability.classList.toggle('is-disabled', !oneClickOn);
    }

    updateTabDot(els.dotChat, chatOn, active);
    updateTabDot(els.dotPicker, pickerOn, active);
    updateTabDot(els.dotRewards, rewardsOn, active);
  }

  async function refresh() {
    const state = await storage.loadAll();
    renderSettings(state.settings);
    renderStats(state);
  }

  function bindLiveSlider(sliderEl, badgeEl, section, key, clampFn, openPicker = null) {
    const markActive = () => {
      activeSliderId = sliderEl.id;
    };
    const clearActive = () => {
      if (activeSliderId === sliderEl.id) activeSliderId = null;
    };

    sliderEl.addEventListener('pointerdown', markActive);
    sliderEl.addEventListener('mousedown', markActive);
    sliderEl.addEventListener('pointerup', clearActive);
    sliderEl.addEventListener('blur', clearActive);

    sliderEl.addEventListener('input', () => {
      const val = clampFn(sliderEl.value);
      badgeEl.textContent = `${val}px`;
      recordPendingSliderPatch(section, key, val);
      queuePreview({ [section]: { [key]: val } }, openPicker);
    });

    sliderEl.addEventListener('change', () => {
      clearActive();
      const val = clampFn(sliderEl.value);
      badgeEl.textContent = `${val}px`;
      clearPendingSliderKey(section, key);
      const patch = { [section]: { [key]: val } };
      queuePreview(patch, openPicker);
      storage.saveSettings(patch);
    });
  }

  function bindDualUnitWidthSlider({
    sliderEl,
    badgeEl,
    unitGroupEl,
    section,
    unitKey,
    pxKey,
    pctKey,
    clampPx,
    clampPct,
    openPicker
  }) {
    const markActive = () => {
      activeSliderId = sliderEl.id;
    };
    const clearActive = () => {
      if (activeSliderId === sliderEl.id) activeSliderId = null;
    };
    const activeUnit = () => normalizeWidthUnit(latestSettings?.[section]?.[unitKey]);

    sliderEl.addEventListener('pointerdown', markActive);
    sliderEl.addEventListener('mousedown', markActive);
    sliderEl.addEventListener('pointerup', clearActive);
    sliderEl.addEventListener('blur', clearActive);

    sliderEl.addEventListener('input', () => {
      const unit = activeUnit();
      const valKey = unit === '%' ? pctKey : pxKey;
      const val = unit === '%' ? clampPct(sliderEl.value) : clampPx(sliderEl.value);
      badgeEl.textContent = `${val}${unit}`;
      latestSettings = deepMergeSettings(latestSettings, { [section]: { [valKey]: val } });
      recordPendingSliderPatch(section, valKey, val);
      queuePreview({ [section]: { [unitKey]: unit, [valKey]: val } }, openPicker);
    });

    sliderEl.addEventListener('change', () => {
      clearActive();
      const unit = activeUnit();
      const valKey = unit === '%' ? pctKey : pxKey;
      const val = unit === '%' ? clampPct(sliderEl.value) : clampPx(sliderEl.value);
      badgeEl.textContent = `${val}${unit}`;
      latestSettings = deepMergeSettings(latestSettings, { [section]: { [valKey]: val } });
      clearPendingSliderKey(section, valKey);
      queuePreview({ [section]: { [unitKey]: unit, [valKey]: val } }, openPicker);
      storage.saveSettings({ [section]: { [unitKey]: unit, [valKey]: val } });
    });

    if (unitGroupEl) {
      Array.from(unitGroupEl.querySelectorAll('[data-unit]')).forEach((btn) => {
        btn.addEventListener('click', () => {
          const nextUnit = normalizeWidthUnit(btn.dataset.unit);
          if (activeUnit() === nextUnit) return;
          clearPendingSliderKey(section, pxKey);
          clearPendingSliderKey(section, pctKey);
          const curSection = (latestSettings && latestSettings[section]) || DEFAULT_SETTINGS[section];
          const valKey = nextUnit === '%' ? pctKey : pxKey;
          const activeVal = nextUnit === '%' ? clampPct(curSection[pctKey]) : clampPx(curSection[pxKey]);
          latestSettings = deepMergeSettings(latestSettings, { [section]: { [unitKey]: nextUnit } });
          applyDualUnitSliderUI({
            sliderEl,
            badgeEl,
            unitGroupEl,
            unit: nextUnit,
            val: activeVal,
            range: nextUnit === '%' ? WIDTH_RANGES[section].pct : WIDTH_RANGES[section].px
          });
          queuePreview({ [section]: { [unitKey]: nextUnit, [valKey]: activeVal } }, openPicker);
          storage.saveSettings({ [section]: { [unitKey]: nextUnit } });
        });
      });
    }
  }

  function bindEvents() {
    const tabs = Array.from(document.querySelectorAll('[data-settings-tab]'));
    function selectTab(selected, save = true) {
      tabs.forEach(tab => {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        document.getElementById(`settings-${tab.dataset.settingsTab}`).hidden = !active;
      });
      if (save) {
        try {
          localStorage.setItem(TAB_STORAGE_KEY, selected.dataset.settingsTab);
        } catch (_) {}
      }
    }
    try {
      const savedTabName = localStorage.getItem(TAB_STORAGE_KEY);
      const savedTab = savedTabName && tabs.find(t => t.dataset.settingsTab === savedTabName);
      if (savedTab) selectTab(savedTab, false);
    } catch (_) {}
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', event => {
        let target;
        if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length];
        if (event.key === 'Home') target = tabs[0];
        if (event.key === 'End') target = tabs[tabs.length - 1];
        if (target) { event.preventDefault(); selectTab(target); target.focus(); }
      });
    });
    document.querySelector('.file-btn').addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); els.inputImport.click(); }
    });
    els.chatEnabled.addEventListener('change', () => {
      storage.saveSettings({
        chatEnabled: els.chatEnabled.checked,
        width: { enabled: els.chatEnabled.checked }
      });
    });
    els.pickerEnabled.addEventListener('change', () => {
      storage.saveSettings({ picker: { enabled: els.pickerEnabled.checked } });
    });
    els.rewardsEnabled.addEventListener('change', () => {
      storage.saveSettings({ rewards: { enabled: els.rewardsEnabled.checked } });
    });
    els.enabled.addEventListener('change', () => {
      storage.saveSettings({ enabled: els.enabled.checked });
    });

    bindDualUnitWidthSlider({
      sliderEl: els.chatWidthPx,
      badgeEl: els.valChatWidthPx,
      unitGroupEl: els.chatWidthUnit,
      section: 'width',
      unitKey: 'chatWidthUnit',
      pxKey: 'chatWidthPx',
      pctKey: 'chatWidthPct',
      clampPx: clampChatWidthPx,
      clampPct: clampChatWidthPct,
      openPicker: null
    });
    els.btnResetWidth.addEventListener('click', () => {
      const unit = normalizeWidthUnit(latestSettings?.width?.chatWidthUnit);
      const isPct = unit === '%';
      const key = isPct ? 'chatWidthPct' : 'chatWidthPx';
      const defVal = isPct ? DEFAULT_SETTINGS.width.chatWidthPct : DEFAULT_SETTINGS.width.chatWidthPx;
      clearPendingSliderKey('width', key);
      latestSettings = deepMergeSettings(latestSettings, { width: { [key]: defVal } });
      els.chatWidthPx.value = String(defVal);
      els.valChatWidthPx.textContent = `${defVal}${unit}`;
      queuePreview({ width: { chatWidthUnit: unit, [key]: defVal } }, null);
      storage.saveSettings({ width: { [key]: defVal } });
      setStatus(`チャット幅を${defVal}${unit}に戻しました`);
    });
    els.showResizeHandle.addEventListener('change', () => {
      storage.saveSettings({ width: { showResizeHandle: els.showResizeHandle.checked } });
    });

    els.keepOpenOnSelect.addEventListener('change', () => {
      storage.saveSettings({ picker: { keepOpenOnSelect: els.keepOpenOnSelect.checked } });
    });
    els.pinCurrentChannel.addEventListener('change', () => {
      storage.saveSettings({ picker: { pinCurrentChannel: els.pinCurrentChannel.checked } });
    });
    els.emoteSize.addEventListener('change', () => {
      const patch = { picker: { emoteSize: els.emoteSize.value } };
      queuePreview(patch, 'emote');
      storage.saveSettings(patch);
    });

    bindDualUnitWidthSlider({
      sliderEl: els.pickerWidthPx,
      badgeEl: els.valPickerWidthPx,
      unitGroupEl: els.pickerWidthUnit,
      section: 'picker',
      unitKey: 'pickerWidthUnit',
      pxKey: 'pickerWidthPx',
      pctKey: 'pickerWidthPct',
      clampPx: clampPickerWidthPx,
      clampPct: clampPickerWidthPct,
      openPicker: 'emote'
    });
    bindLiveSlider(els.pickerHeightPx, els.valPickerHeightPx, 'picker', 'pickerHeightPx', clampPickerHeight, 'emote');

    els.rewardsOneClickRedeem.addEventListener('change', () => {
      storage.saveSettings({ rewards: { oneClickRedeem: els.rewardsOneClickRedeem.checked } });
    });
    els.rewardsPrecheckAvailability.addEventListener('change', () => {
      storage.saveSettings({ rewards: { precheckAvailability: els.rewardsPrecheckAvailability.checked } });
    });
    els.rewardsAutoCloseOnRedeem.addEventListener('change', () => {
      storage.saveSettings({ rewards: { autoCloseOnRedeem: els.rewardsAutoCloseOnRedeem.checked } });
    });
    els.rewardsItemSize.addEventListener('change', () => {
      const patch = { rewards: { itemSize: els.rewardsItemSize.value } };
      queuePreview(patch, 'rewards');
      storage.saveSettings(patch);
    });

    bindDualUnitWidthSlider({
      sliderEl: els.rewardsWidthPx,
      badgeEl: els.valRewardsWidthPx,
      unitGroupEl: els.rewardsWidthUnit,
      section: 'rewards',
      unitKey: 'widthUnit',
      pxKey: 'widthPx',
      pctKey: 'widthPct',
      clampPx: clampRewardsWidthPx,
      clampPct: clampRewardsWidthPct,
      openPicker: 'rewards'
    });
    bindLiveSlider(els.rewardsHeightPx, els.valRewardsHeightPx, 'rewards', 'heightPx', clampRewardsHeightPx, 'rewards');

    window.addEventListener('pointerup', () => {
      activeSliderId = null;
    });
    window.addEventListener('blur', () => {
      activeSliderId = null;
      flushPendingSliderSave();
    });
    window.addEventListener('pagehide', () => {
      activeSliderId = null;
      flushPendingSliderSave();
    });

    if (els.btnOpenOptions) {
      els.btnOpenOptions.addEventListener('click', () => {
        const url = chrome.runtime.getURL('options/options.html#favorites');
        if (chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url }, () => {
            if (chrome.runtime.lastError && chrome.runtime.openOptionsPage) {
              chrome.runtime.openOptionsPage();
            }
          });
        } else if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        }
      });
    }

    els.btnSyncTab.addEventListener('click', () => {
      if (!chrome.tabs || !chrome.tabs.query) {
        setStatus('Twitchのページでスタンプ欄の↻ボタンから同期してください');
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id == null) {
          setStatus('アクティブなタブが見つかりません');
          return;
        }
        activeTabId = tab.id;
        chrome.tabs.sendMessage(tab.id, { type: 'TCC_TRIGGER_SYNC' }, (res) => {
          if (chrome.runtime.lastError) {
            setStatus('Twitchまたはクリエイターダッシュボードのタブで実行してください');
            return;
          }
          refresh();
          setStatus(res && res.ok ? 'スタンプを同期しました' : '同期を実行しました');
        });
      });
    });

    els.btnExport.addEventListener('click', async () => {
      const data = await storage.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `twitch-chat-customizer-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('バックアップJSONをダウンロードしました');
    });

    els.inputImport.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        await storage.importData(json);
        await refresh();
        setStatus('バックアップを読み込みました');
      } catch (err) {
        setStatus(
          err && err.message && !/JSON/i.test(err.message)
            ? `読み込み失敗: ${err.message}`
            : '読み込み失敗: 無効なJSONファイルです'
        );
      } finally {
        els.inputImport.value = '';
      }
    });

    els.btnClearCatalog.addEventListener('click', async () => {
      await storage.clearCatalog();
      await refresh();
      setStatus('スタンプキャッシュを消去しました（お気に入り・順番は保持）');
    });

    let resetArmTimer = null;
    function disarmReset() {
      if (resetArmTimer) {
        clearTimeout(resetArmTimer);
        resetArmTimer = null;
      }
      if (els.btnResetSettings) {
        els.btnResetSettings.classList.remove('is-armed');
        els.btnResetSettings.textContent = 'リセット';
      }
    }
    if (els.btnResetSettings) {
      els.btnResetSettings.addEventListener('click', async () => {
        if (!els.btnResetSettings.classList.contains('is-armed')) {
          els.btnResetSettings.classList.add('is-armed');
          els.btnResetSettings.textContent = 'もう一度押す';
          setStatus('もう一度「リセット」を押すと設定を初期値に戻します');
          resetArmTimer = setTimeout(disarmReset, 3000);
          return;
        }
        disarmReset();
        pendingSliderPatch = null;
        activeSliderId = null;
        await storage.saveSettings(DEFAULT_SETTINGS);
        queuePreview(DEFAULT_SETTINGS, null);
        await refresh();
        setStatus('設定を初期値に戻しました');
      });
    }

    storage.onChanged(() => {
      refresh();
    });
  }

  resolveActiveTabId(() => {});
  renderVersion();
  bindEvents();
  refresh();
})();
