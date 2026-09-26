const fs = require('node:fs');
const path = require('node:path');
const INSTALLER_ASSET = 'DeltaHarmonicaStudio-Setup-x64.exe';
const CHECKSUM_ASSET = 'SHA256SUMS.txt';
function installerPath(root) {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return path.join(root, project.build.directories.output, `${project.build.productName} Setup ${project.version}.exe`);
}
module.exports = { installerPath, INSTALLER_ASSET, CHECKSUM_ASSET };
