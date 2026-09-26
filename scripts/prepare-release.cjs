const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { installerPath, INSTALLER_ASSET, CHECKSUM_ASSET } = require('./release-files.cjs');

function prepareRelease(root) {
  const installer = fs.readFileSync(installerPath(root));
  if (installer.subarray(0, 2).toString() !== 'MZ') throw new Error('安装包不是 Windows 可执行文件');
  const output = path.join(root, 'release', 'nightly');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, INSTALLER_ASSET), installer);
  const digest = crypto.createHash('sha256').update(installer).digest('hex');
  fs.writeFileSync(path.join(output, CHECKSUM_ASSET), `${digest}  ${INSTALLER_ASSET}\n`);
  console.log(`测试版产物就绪：${INSTALLER_ASSET}，SHA-256 ${digest}`);
  return output;
}
if (require.main === module) prepareRelease(path.resolve(__dirname, '..'));
module.exports = { prepareRelease };
