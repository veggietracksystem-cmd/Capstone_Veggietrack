// Deletes every uploaded image (harvest and delivery proof photos) from the app's
// Cloudinary account. Intended to be run together with sql/reset_data.sql.
//
// Usage:
//   node backend/scripts/clear_cloudinary.js            dry run (lists the images)
//   node backend/scripts/clear_cloudinary.js --confirm  deletes the images

const https = require('https');
require('dotenv').config();

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('Missing CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET in backend/.env');
  process.exit(1);
}

const auth = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString('base64');

function adminRequest(pathAndQuery, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.cloudinary.com',
        path: `/v1_1/${CLOUDINARY_CLOUD_NAME}${pathAndQuery}`,
        method,
        headers: { Authorization: `Basic ${auth}` },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode >= 400) return reject(new Error(JSON.stringify(json)));
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const confirm = process.argv.includes('--confirm');

  const listing = await adminRequest('/resources/image/upload?max_results=500');
  const resources = listing.resources || [];

  if (resources.length === 0) {
    console.log('No images found in this Cloudinary account. Nothing to delete.');
    return;
  }

  console.log(`Found ${resources.length} image(s) in cloud "${CLOUDINARY_CLOUD_NAME}":`);
  resources.forEach((r) => console.log(`  - ${r.public_id} (${r.format}, ${Math.round(r.bytes / 1024)} KB)`));

  if (!confirm) {
    console.log('\nDry run only — nothing deleted. Re-run with --confirm to actually delete these.');
    return;
  }

  const result = await adminRequest('/resources/image/upload?all=true', 'DELETE');
  console.log('\nDeleted:', Object.keys(result.deleted || {}).length, 'image(s).');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
