const fs = require('fs');
const path = require('path');

// react-native-dotenv inlines these values at transform time, but .env is not an
// input Babel or Metro tracks: with api.cache(true) an edited .env kept serving
// the previously inlined value (an empty BACKEND_URL fell back to localhost).
// Keying the config cache on the file's contents invalidates those transforms.
const ENV_FILE = path.join(__dirname, '.env');
const readEnvFile = () => { try { return fs.readFileSync(ENV_FILE, 'utf8'); } catch { return ''; } };

module.exports = function(api) {
  api.cache.using(readEnvFile);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module:react-native-dotenv', {
        moduleName: '@env',
        path: '.env',
        allowlist: ['BACKEND_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_UPLOAD_PRESET'],
      }],
    ],
  };
};
