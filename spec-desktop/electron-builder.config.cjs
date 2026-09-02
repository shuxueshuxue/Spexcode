const path = require('node:path')

const bundleDir = process.env.SPEXCODE_DESKTOP_BUNDLE_DIR
if (!bundleDir) throw new Error('desktop packaging requires SPEXCODE_DESKTOP_BUNDLE_DIR')

module.exports = {
  appId: 'com.spexcode.desktop',
  productName: 'SpexCode',
  artifactName: '${productName}-${version}.${ext}',
  executableName: 'spexcode',
  protocols: [{ name: 'SpexCode', schemes: ['spexcode'] }],
  electronVersion: '43.4.1',
  directories: {
    app: path.resolve(__dirname),
    output: process.env.SPEXCODE_DESKTOP_OUTPUT_DIR || path.resolve(__dirname, '..', 'dist-desktop'),
  },
  files: ['**/*', '!node_modules/**'],
  npmRebuild: false,
  extraResources: [
    { from: path.join(__dirname, 'wsl-bootstrap.sh'), to: 'wsl-bootstrap.sh' },
    { from: bundleDir, to: 'spexcode', filter: ['**/*', '!node_modules/**/*'] },
    { from: path.join(bundleDir, 'node_modules'), to: 'spexcode/node_modules', filter: ['**/*'] },
  ],
  linux: {
    maintainer: 'maintainers@spexcode.dev',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    category: 'Development',
    syncDesktopName: true,
  },
  mac: { target: ['dmg'] },
  win: { target: ['nsis'] },
  nsis: { perMachine: false },
  // node-entry.mjs relies on ELECTRON_RUN_AS_NODE for CLI self-spawns.
  electronFuses: { runAsNode: true },
  publish: null,
}
