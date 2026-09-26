const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appBuilderRequire('@electron/asar');
const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');

function verifyDirectory(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) verifyDirectory(next);
    else assert.ok(asar.extractFile(archive, next).equals(fs.readFileSync(path.join(root, next))), `打包文件不匹配：${next}`);
  }
}
verifyDirectory('dist');
verifyDirectory('dist-electron');
assert.ok(fs.readFileSync(path.join(root, 'helper', 'DeltaHarmonicaInput.exe')).equals(fs.readFileSync(path.join(root, 'release', 'win-unpacked', 'resources', 'helper', 'DeltaHarmonicaInput.exe'))));
const { installerPath } = require('./release-files.cjs');
const installer = installerPath(root);
assert.ok(fs.statSync(installer).size > 50 * 1024 * 1024);
assert.equal(fs.readFileSync(installer).subarray(0, 2).toString(), 'MZ');
process.stdout.write('安装包检查通过：程序文件、记谱字体、输入辅助程序与当前构建一致。\n');
