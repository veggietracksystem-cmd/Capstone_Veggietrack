module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(process.env.IOS_BUNDLE_IDENTIFIER ? { bundleIdentifier: process.env.IOS_BUNDLE_IDENTIFIER } : {}),
  },
});
