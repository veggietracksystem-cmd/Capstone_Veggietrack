import { Platform } from 'react-native';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from '@env';

const UPLOAD_MESSAGE = 'Unable to upload image. Please try again.';
const uploadError = (code, details = {}) => Object.assign(new Error(UPLOAD_MESSAGE), { code, stage: 'upload', ...details });
const MIME_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/gif': 'gif' };

export function prepareNativeImage(asset) {
  let uri = typeof asset?.uri === 'string' ? asset.uri.trim() : '';
  if (uri.startsWith('/')) uri = `file://${uri}`;
  // Android networking uses ContentResolver; preserve content:// and encoded paths.
  if (!/^(file|content):\/\//i.test(uri)) throw uploadError('IMAGE_PREPARATION_FAILED');
  const suppliedName = asset.fileName || uri.split('/').pop()?.split(/[?#]/)[0] || '';
  const extension = suppliedName.split('.').pop()?.toLowerCase();
  const inferredType = Object.keys(MIME_EXTENSIONS).find(type => MIME_EXTENSIONS[type] === extension) || (extension === 'jpeg' ? 'image/jpeg' : null);
  const type = asset.mimeType || inferredType;
  if (!type || !MIME_EXTENSIONS[type]) throw uploadError('IMAGE_PREPARATION_FAILED');
  const stem = suppliedName.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'proof';
  return { uri, type, name: `${stem}.${MIME_EXTENSIONS[type]}` };
}

// Expo replaces the global fetch with expo/fetch, which rejects React Native's
// { uri, type, name } FormData parts ("Unsupported FormDataPart implementation")
// and needs a Blob-like file it can read bytes from. expo-file-system's File is one.
function nativeUploadPart(asset) {
  const image = prepareNativeImage(asset);
  const { File } = require('expo-file-system');
  return new File(image.uri);
}

function prepareNativeImageSafe(asset) {
  try { return Platform.OS === 'web' ? { uri: asset?.uri } : { ...prepareNativeImage(asset), size: asset?.fileSize }; }
  catch (error) { return { uri: asset?.uri, error: error.code }; }
}

// Only the public cloud name and unsigned preset belong in the mobile build.
export async function uploadToCloudinary(asset, { timeoutMs = 30000 } = {}) {
  const cloud = CLOUDINARY_CLOUD_NAME?.trim();
  const preset = CLOUDINARY_UPLOAD_PRESET?.trim();
  if (!cloud || cloud === 'your_cloud_name' || !/^[\w-]+$/.test(cloud) || !preset || preset === 'your_unsigned_preset') throw uploadError('CLOUDINARY_CONFIGURATION');
  if (!asset?.uri) throw uploadError('IMAGE_PREPARATION_FAILED');
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(uploadError('UPLOAD_TIMEOUT')); }, timeoutMs);
  });
  const operation = async () => {
    const formData = new FormData();
    formData.append('upload_preset', preset);
    try {
      if (Platform.OS === 'web') {
        let file = asset.file;
        if (!file) {
          const local = await fetch(asset.uri, { signal: controller.signal });
          if (!local.ok) throw uploadError('IMAGE_PREPARATION_FAILED');
          file = await local.blob();
        }
        if (!file.size || !/^image\//.test(file.type || asset.mimeType || '')) throw uploadError('IMAGE_PREPARATION_FAILED');
        formData.append('file', file, asset.fileName || file.name || `proof.${MIME_EXTENSIONS[file.type] || 'jpg'}`);
      } else formData.append('file', nativeUploadPart(asset));
    } catch (error) {
      if (timedOut) throw uploadError('UPLOAD_TIMEOUT');
      throw error.code ? error : uploadError('IMAGE_PREPARATION_FAILED');
    }
    let response;
    try {
      // fetch supplies multipart Content-Type including the required boundary.
      response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: formData, signal: controller.signal });
    } catch (error) {
      // TEMP rider-dashboard diagnostics — remove once pickup upload is fixed.
      console.log('[rider-debug] UPLOAD fetch FAILED', error?.name, error?.message, JSON.stringify(prepareNativeImageSafe(asset)));
      throw uploadError(timedOut ? 'UPLOAD_TIMEOUT' : 'CLOUDINARY_UNREACHABLE', { cause: `${error?.name}: ${error?.message}`, file: prepareNativeImageSafe(asset) });
    }
    let data;
    try { data = JSON.parse(await response.text()); } catch { data = null; }
    if (!response.ok || !data?.secure_url) {
      const configurationFailure = /upload preset|unsigned|cloud name|api key/i.test(data?.error?.message || '');
      throw uploadError(configurationFailure ? 'CLOUDINARY_CONFIGURATION' : 'CLOUDINARY_UPLOAD_FAILED', { status: response.status, cause: data?.error?.message });
    }
    if (!/^https:\/\/res\.cloudinary\.com\//.test(data.secure_url)) throw uploadError('CLOUDINARY_UPLOAD_FAILED');
    return data.secure_url;
  };
  try { return await Promise.race([operation(), deadline]); }
  finally { clearTimeout(timer); }
}
