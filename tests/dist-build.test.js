'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildDist, collectManifestPaths } = require('../scripts/build-dist.js');

test('buildDist outputs a clean, valid, dev-stripped package and zip archive', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpOut = fs.mkdtempSync(path.join(repoRoot, '.tmp-dist-test-'));
  try {
    const result = buildDist({ outDir: tmpOut });
    assert.ok(fs.existsSync(result.stageDir));
    assert.ok(fs.existsSync(result.zipPath));
    assert.ok(result.zipSizeBytes > 0);
    assert.ok(result.files.includes('README.md'));
    assert.ok(result.files.includes('manifest.json'));

    // Every manifest asset must be present in staged output
    const manifest = JSON.parse(fs.readFileSync(path.join(result.stageDir, 'manifest.json'), 'utf8'));
    for (const relPath of collectManifestPaths(manifest)) {
      assert.ok(fs.existsSync(path.join(result.stageDir, relPath)), `Missing asset in dist: ${relPath}`);
    }

    // Dev-only files and dev-autoreload code must be excluded
    assert.equal(fs.existsSync(path.join(result.stageDir, 'dev-autoreload.json')), false);
    assert.equal(fs.existsSync(path.join(result.stageDir, 'tests')), false);
    assert.equal(fs.existsSync(path.join(result.stageDir, 'package.json')), false);
    assert.equal(fs.existsSync(path.join(result.stageDir, 'scripts')), false);

    const stagedBg = fs.readFileSync(path.join(result.stageDir, 'background.js'), 'utf8');
    const stagedMain = fs.readFileSync(path.join(result.stageDir, 'content/main.js'), 'utf8');
    assert.equal(stagedBg.includes('TCC_DEV_RELOAD'), false);
    assert.equal(stagedMain.includes('TCC_DEV_RELOAD'), false);
    assert.equal(stagedMain.includes('data-tcc-dev-controller'), false);
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});
