const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const babel = require('../../mobile/node_modules/@babel/core');
const config = require('../../mobile/babel.config')({ cache() {} });
const options = config.plugins.find(p => p[0] === 'module:react-native-dotenv')[1];
const publicNames = ['BACKEND_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_UPLOAD_PRESET'];

test('mobile public upload config resolves from local dotenv and EAS process environment; private imports are refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veggietrack-env-'));
  const dotenvPath = path.join(dir, '.env');
  const saved = Object.fromEntries(publicNames.map(name => [name, process.env[name]]));
  const compile = code => babel.transformSync(code, { configFile: false, babelrc: false,
    plugins: [[require.resolve('../../mobile/node_modules/react-native-dotenv'), { ...options, path: dotenvPath }]] }).code;
  try {
    for (const name of publicNames) delete process.env[name];
    fs.writeFileSync(dotenvPath, publicNames.map((name, i) => `${name}=local-public-${i}`).join('\n'));
    const source = `import { ${publicNames.join(', ')} } from '@env'; export const config = [${publicNames.join(', ')}];`;
    const local = compile(source);
    for (let i = 0; i < publicNames.length; i++) assert.ok(local.includes(`local-public-${i}`));
    for (let i = 0; i < publicNames.length; i++) process.env[publicNames[i]] = `eas-public-${i}`;
    const production = compile(source);
    for (let i = 0; i < publicNames.length; i++) assert.ok(production.includes(`eas-public-${i}`));
    assert.ok(!production.includes('local-public-'));
    assert.throws(() => compile("import { SUPABASE_SERVICE_KEY } from '@env'; export const leaked = SUPABASE_SERVICE_KEY;"), /allowlist/);
  } finally {
    for (const name of publicNames) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    // Delete only this test's explicitly-created files, never a recursive path.
    fs.unlinkSync(dotenvPath); fs.rmdirSync(dir);
  }
});

test('EAS profiles select the corresponding public configuration environment', () => {
  const profiles = require('../../mobile/eas.json').build;
  for (const name of ['development', 'preview', 'production']) assert.equal(profiles[name].environment, name);
});
