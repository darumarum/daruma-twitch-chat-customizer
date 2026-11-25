'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'dist');
const PACKAGE_FOLDER_NAME = 'twitch-chat-customizer';
const ALLOWED_FILES = ['manifest.json', 'background.js', 'README.md'];
const ALLOWED_DIRS = ['icons', 'shared', 'content', 'popup', 'options'];
const DEV_STRIP_RULES = [
  { relPath: 'background.js', marker: '// Local development only.' },
  { relPath: 'content/main.js', marker: '// Development reloads wait' }
];

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function stripDevSection(filePath, marker) {
  const content = fs.readFileSync(filePath, 'utf8');
  const idx = content.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Development marker not found in ${filePath}: ${marker}`);
  }
  const stripped = content.slice(0, idx).replace(/\s+$/, '') + '\n';
  fs.writeFileSync(filePath, stripped, 'utf8');
}

function collectManifestPaths(manifest) {
  const refs = [];
  const add = (val) => {
    if (typeof val === 'string' && val.trim()) refs.push(val.trim());
  };
  const addObjectValues = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const v of Object.values(obj)) add(v);
    }
  };

  addObjectValues(manifest.icons);
  add(manifest.action?.default_popup);
  addObjectValues(manifest.action?.default_icon);
  add(manifest.background?.service_worker);
  add(manifest.options_page);
  add(manifest.options_ui?.page);

  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs?.js)) cs.js.forEach(add);
      if (Array.isArray(cs?.css)) cs.css.forEach(add);
    }
  }
  return Array.from(new Set(refs));
}

function listFilesRecursive(dir, baseDir = dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full, baseDir));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, full).replace(/\\/g, '/'));
    }
  }
  return files.sort();
}

function buildDist(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : ROOT_DIR;
  const outDir = options.outDir ? path.resolve(options.outDir) : path.join(rootDir, 'dist');
  const stageDir = path.join(outDir, PACKAGE_FOLDER_NAME);

  const manifestRaw = fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const safeVersion = String(manifest.version || '1.0.0').replace(/[^0-9A-Za-z._-]/g, '_');
  const zipName = `${PACKAGE_FOLDER_NAME}-v${safeVersion}.zip`;
  const zipPath = path.join(outDir, zipName);

  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const relFile of ALLOWED_FILES) {
    const src = path.join(rootDir, relFile);
    if (!fs.existsSync(src)) {
      throw new Error(`Required runtime file missing: ${relFile}`);
    }
    fs.copyFileSync(src, path.join(stageDir, relFile));
  }

  for (const relDir of ALLOWED_DIRS) {
    const src = path.join(rootDir, relDir);
    if (!fs.existsSync(src)) {
      throw new Error(`Required runtime directory missing: ${relDir}`);
    }
    copyDirRecursive(src, path.join(stageDir, relDir));
  }

  for (const rule of DEV_STRIP_RULES) {
    stripDevSection(path.join(stageDir, rule.relPath), rule.marker);
  }

  const stageManifest = JSON.parse(fs.readFileSync(path.join(stageDir, 'manifest.json'), 'utf8'));
  const manifestPaths = collectManifestPaths(stageManifest);
  for (const relRef of manifestPaths) {
    const target = path.join(stageDir, relRef);
    if (!fs.existsSync(target)) {
      throw new Error(`Manifest references missing staged file: ${relRef}`);
    }
  }

  const stagedFiles = listFilesRecursive(stageDir);
  for (const relFile of stagedFiles) {
    if (relFile.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', path.join(stageDir, relFile)], { stdio: 'pipe' });
    }
  }

  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath '${PACKAGE_FOLDER_NAME}' -DestinationPath '${zipName}' -Force`
    ],
    { cwd: outDir, stdio: 'pipe' }
  );

  const zipStat = fs.statSync(zipPath);
  if (!zipStat.isFile() || zipStat.size <= 0) {
    throw new Error(`Failed to create distribution zip: ${zipPath}`);
  }

  return {
    version: manifest.version,
    stageDir,
    zipPath,
    zipSizeBytes: zipStat.size,
    files: stagedFiles
  };
}

if (require.main === module) {
  const result = buildDist();
  console.log(`Built ${PACKAGE_FOLDER_NAME} v${result.version} (${result.files.length} files)`);
  console.log(`Unpacked: ${result.stageDir}`);
  console.log(`Archive:  ${result.zipPath} (${result.zipSizeBytes} bytes)`);
}

module.exports = {
  buildDist,
  collectManifestPaths,
  DEFAULT_OUT_DIR,
  PACKAGE_FOLDER_NAME
};
