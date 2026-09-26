const { createRequire } = require('node:module');
const project = require('../package.json');
const requireBuilder = createRequire(require.resolve('electron-builder'));
const requireLibrary = createRequire(requireBuilder.resolve('app-builder-lib'));
const { UUID } = requireLibrary('builder-util-runtime');
// Match NsisTarget's stable identity; DisplayName defaults to productName + version.
const guid = project.build.nsis.guid || UUID.v5(
  project.build.appId,
  UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'),
);
process.stdout.write(JSON.stringify({ uninstallKey: guid.replace(/\\/g, ' - ') }));
