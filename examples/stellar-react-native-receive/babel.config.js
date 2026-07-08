module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['.'],
        alias: {
          '@wraith-protocol/sdk': '../../src',
          '@wraith-protocol/sdk-react': '../../packages/sdk-react/src',
        },
      },
    ],
  ],
};
