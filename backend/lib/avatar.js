// Accept original uploads only; credentials, transformations and arbitrary hosts
// never become profile image URLs. No network fetch of client-provided URLs.
function validateCloudinaryImageUrl(value, cloud = process.env.CLOUDINARY_CLOUD_NAME, label = 'photo') {
  if (value === null) return null; // Existing accounts may retain initials.
  if (!cloud || !/^[A-Za-z0-9_-]+$/.test(cloud)) {
    throw Object.assign(new Error(`${label} storage is not configured.`), { status: 503 });
  }
  if (typeof value !== 'string' || value.length > 2048 ||
      !/^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/v[0-9]+\/[A-Za-z0-9_./-]+$/.test(value) ||
      value.includes('..') || new URL(value).pathname.split('/')[1] !== cloud) {
    throw Object.assign(new Error(`Select a ${label} uploaded to VeggieTrack photo storage.`), { status: 400 });
  }
  return value;
}
function validateAvatarUrl(value, cloud = process.env.CLOUDINARY_CLOUD_NAME) {
  return validateCloudinaryImageUrl(value, cloud, 'profile photo');
}
function validateBatchPhotoUrl(value, cloud = process.env.CLOUDINARY_CLOUD_NAME) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error('A recent batch photo is required before this batch can be listed.'), { status: 400 });
  }
  return validateCloudinaryImageUrl(value, cloud, 'recent batch photo');
}
module.exports = { validateAvatarUrl, validateBatchPhotoUrl };
