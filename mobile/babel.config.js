const fs = require('fs');
const path = require('path');

// react-native-dotenv inlines .env values at transform time, but Babel and Metro
// do not track .env. Keying the cache on its contents rebuilds after an edit.
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
