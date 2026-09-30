const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const sourceDirs = ['backend/lib', 'backend/scripts', 'backend/sql', 'backend/test', 'mobile/src', 'mobile/test', 'mobile/android/app/src'];
const sourceFiles = [
  'backend/index.js', 'backend/package.json', 'backend/.env.example',
  'mobile/App.js', 'mobile/index.js', 'mobile/package.json', 'mobile/app.json',
  'mobile/app.config.js', 'mobile/babel.config.js', 'mobile/metro.config.js',
  'mobile/eas.json', 'mobile/.env.example', 'mobile/android/build.gradle',
  'mobile/android/settings.gradle', 'mobile/android/gradle.properties',
  'mobile/android/app/build.gradle', 'mobile/android/app/proguard-rules.pro',
  'scripts/export-appendix.cjs',
];
const textExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.sql', '.kt', '.java', '.xml', '.gradle', '.properties', '.pro']);
const maintenanceFiles = new Set(['backend/scripts/clear_cloudinary.js', 'backend/sql/reset_data.sql', 'backend/sql/reset_test_data_keep_distributor.sql']);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bsb_secret_[A-Za-z0-9_-]{16,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /\b(?:ghp_|github_pat_|xox[baprs]-|sk_live_)[A-Za-z0-9_-]{15,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[0-9A-Za-z_-]{30,}/,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:]+:[^\s@]+@/,
];

function localSecrets() {
  const values = [];
  for (const file of ['backend/.env', 'mobile/.env']) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    for (const line of fs.readFileSync(absolute, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('EXPO_PUBLIC_')) continue;
      if (!/(?:SECRET|PASSWORD|TOKEN|SERVICE.*KEY|CLOUDINARY_API_KEY)/.test(match[1])) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
      if (value.length >= 8) values.push(value);
    }
  }
  return values;
}

function collect(directory) {
  if (!fs.existsSync(path.join(root, directory))) return [];
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) return [];
    if (['node_modules', 'build', 'dist', 'credentials', 'secrets'].includes(entry.name)) return [];
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collect(relative);
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) return [];
    if (maintenanceFiles.has(relative)) return [];
    if (/(?:service.?account|firebase-adminsdk|google-services)|^(?:credentials|secrets)\.json$/i.test(entry.name)) return [];
    return [relative];
  });
}

function main() {
  if (process.argv.slice(2).some(argument => argument !== '--check')) {
    throw new Error('Usage: node scripts/export-appendix.cjs [--check]');
  }
  const secrets = localSecrets();
  const files = [...new Set([...sourceFiles, ...sourceDirs.flatMap(collect)])].sort();
  const content = files.map(file => {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink()) {
      throw new Error(`Missing or symbolic source file: ${file}`);
    }
    if (!fs.realpathSync(absolute).startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
      throw new Error(`Source file resolves outside the repository: ${file}`);
    }
    const buffer = fs.readFileSync(absolute);
    const text = buffer.toString('utf8');
    if (secretPatterns.some(pattern => pattern.test(text)) || secrets.some(value => text.includes(value))) {
      throw new Error(`Possible credential found in ${file}; export stopped before writing files.`);
    }
    return { file, buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  });
  if (process.argv.includes('--check')) {
    console.log(`Appendix check passed for ${content.length} source files; no files written.`);
    return;
  }
  const exportRoot = path.join(root, 'appendix-export');
  if (fs.existsSync(exportRoot) && fs.lstatSync(exportRoot).isSymbolicLink()) {
    throw new Error('The appendix export directory must not be a symbolic link.');
  }
  fs.mkdirSync(exportRoot, { recursive: true });
  const destination = fs.mkdtempSync(path.join(exportRoot, 'veggietrack-'));
  for (const { file, buffer } of content) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer, { flag: 'wx' });
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(content.map(({ file, sha256 }) => ({ file, sha256 })), null, 2), { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'APPENDIX_README.txt'),
    'VeggieTrack application source appendix\n\n' +
    'This snapshot contains current backend/mobile source, tests, SQL and selected configuration templates.\n' +
    'It excludes real environment files, signing keys, dependencies, generated builds, Git history, assistant instructions, old audit reports, data-reset and bulk-image-deletion scripts, the standalone design prototype and the separate Expo starter.\n' +
    'Assets and dependency lockfiles are omitted; use the original repository to build the app.\n' +
    'SQL files are reference source, not a sequence to execute. Follow the repository setup instructions for the required migrations.\n' +
    'Credential checks cover common token formats and known local server secrets; review this export before publication.\n', { flag: 'wx' });
  console.log(`Exported ${content.length} source files to ${path.relative(root, destination)}.`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
