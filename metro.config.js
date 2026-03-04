// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Enable Node.js package "exports" field resolution.
// Required for @sentry-internal/* packages that only define entry points via exports.
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, { input: "./src/styles/global.css" });
