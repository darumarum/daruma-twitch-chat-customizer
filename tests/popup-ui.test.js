'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const constants = require('../shared/constants.js');

function readText(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
}

function extractHtmlIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    ids.add(m[1]);
  }
  return ids;
}

function extractReferencedIds(js) {
  const ids = new Set();
  for (const m of js.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    ids.add(m[1]);
  }
  return ids;
}

test('popup.js element IDs all exist in popup.html and all tabs map cleanly', () => {
  const popupHtml = readText('popup/popup.html');
  const popupJs = readText('popup/popup.js');
  const htmlIds = extractHtmlIds(popupHtml);

  for (const refId of extractReferencedIds(popupJs)) {
    assert.ok(htmlIds.has(refId), `Missing element #${refId} in popup/popup.html`);
  }

  const tabMatches = Array.from(popupHtml.matchAll(/data-settings-tab="([^"]+)"/g));
  assert.deepEqual(
    tabMatches.map((m) => m[1]),
    ['chat', 'picker', 'rewards', 'data']
  );

  for (const m of tabMatches) {
    const tabName = m[1];
    assert.ok(htmlIds.has(`tab-${tabName}`), `Missing #tab-${tabName}`);
    assert.ok(htmlIds.has(`settings-${tabName}`), `Missing #settings-${tabName}`);
  }
});

test('all DEFAULT_SETTINGS.rewards keys are wired and removed options are absent in popup UI', () => {
  const popupHtml = readText('popup/popup.html');
  const popupJs = readText('popup/popup.js');
  const rewardsKeys = Object.keys(constants.DEFAULT_SETTINGS.rewards);

  assert.ok(rewardsKeys.length >= 9);
  for (const key of rewardsKeys) {
    if (key === 'widthPct') continue;
    const optId = `opt-rewards${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    assert.ok(popupHtml.includes(`id="${optId}"`), `Missing control #${optId} in popup/popup.html`);
    assert.ok(popupJs.includes(optId), `Missing binding for #${optId} in popup/popup.js`);
  }

  for (const unitId of ['opt-chatWidthUnit', 'opt-pickerWidthUnit', 'opt-rewardsWidthUnit']) {
    assert.ok(popupHtml.includes(`id="${unitId}"`), `Missing unit toggle #${unitId} in popup/popup.html`);
    assert.ok(popupJs.includes(unitId), `Missing unit toggle binding for #${unitId} in popup/popup.js`);
  }
  for (const pctKey of ['chatWidthPct', 'pickerWidthPct', 'widthPct']) {
    assert.ok(popupJs.includes(pctKey), `Missing percentage key ${pctKey} in popup/popup.js`);
  }

  for (const removedId of [
    'opt-replaceNativeButton',
    'opt-appendSpace',
    'opt-rewardsCompactList',
    'opt-rewardsHideAllTab',
    'opt-rewardsDisableAnimation'
  ]) {
    assert.equal(popupHtml.includes(`id="${removedId}"`), false, `Removed option #${removedId} still in popup.html`);
  }

  assert.ok(
    popupHtml.indexOf('id="btn-open-options"') < popupHtml.indexOf('id="opt-keepOpenOnSelect"'),
    'btn-open-options should appear directly below the picker section head above opt-keepOpenOnSelect'
  );
});

test('options.js element IDs all exist in options.html and all tabs map cleanly', () => {
  const optionsHtml = readText('options/options.html');
  const optionsJs = readText('options/options.js');
  const htmlIds = extractHtmlIds(optionsHtml);

  for (const refId of extractReferencedIds(optionsJs)) {
    assert.ok(htmlIds.has(refId), `Missing element #${refId} in options/options.html`);
  }

  const tabMatches = Array.from(optionsHtml.matchAll(/data-tab="([^"]+)"/g));
  assert.deepEqual(
    tabMatches.map((m) => m[1]),
    ['favorites', 'channels', 'browse']
  );

  for (const m of tabMatches) {
    const tabName = m[1];
    assert.ok(htmlIds.has(`tab-${tabName}`), `Missing #tab-${tabName}`);
    assert.ok(htmlIds.has(`panel-${tabName}`), `Missing #panel-${tabName}`);
  }
});
