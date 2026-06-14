import { Platform } from 'react-native';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from '@env';

// Uploads a local image (from expo-image-picker) to Cloudinary using an
// UNSIGNED upload preset, and returns the hosted secure_url.
//
// Requires in .env:
//   CLOUDINARY_CLOUD_NAME=...
//   CLOUDINARY_UPLOAD_PRESET=...   (must be an *unsigned* preset)
export async function uploadToCloudinary(asset) {
  if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME === 'your_cloud_name' ||
      !CLOUDINARY_UPLOAD_PRESET || CLOUDINARY_UPLOAD_PRESET === 'your_unsigned_preset') {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in .env.');
  }

  const uri = asset?.uri;
  if (!uri) throw new Error('No image selected.');

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  if (Platform.OS === 'web') {
    // On web the picker gives a blob/data URI — fetch it into a Blob to upload.
    const blob = await (await fetch(uri)).blob();
    formData.append('file', blob, asset.fileName || 'proof.jpg');
  } else {
    // On native, append the file descriptor directly.
    const name = asset.fileName || uri.split('/').pop() || 'proof.jpg';
    const type = asset.mimeType || 'image/jpeg';
    formData.append('file', { uri, name, type });
  }

  let response;
  try {
    response = await fetch(url, { method: 'POST', body: formData });
  } catch (err) {
    throw new Error('Upload failed — check your internet connection.');
  }

  const data = await response.json();
  if (!response.ok || !data.secure_url) {
    throw new Error(data?.error?.message || 'Cloudinary upload failed.');
  }
  return data.secure_url;
}
