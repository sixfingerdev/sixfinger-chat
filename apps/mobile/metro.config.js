const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

// @sixfinger/shared kaynağı (TS) monorepo kökündeki packages/shared altında durur.
config.watchFolders = [path.join(root, 'packages/shared')];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, 'node_modules'),
  path.join(root, 'node_modules'),
];
config.resolver.extraNodeModules = {
  '@sixfinger/shared': path.join(root, 'packages/shared/src'),
};

module.exports = config;
