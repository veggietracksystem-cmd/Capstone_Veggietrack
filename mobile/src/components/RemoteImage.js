import { useEffect, useState } from 'react';
import { Image, Platform } from 'react-native';

// On some Android builds <Image> never finishes loading remote https photos, so
// on native each photo is downloaded to the cache directory and shown from there.
// Local URIs and web are passed through unchanged.
const pending = new Map();

function cacheName(url) {
  return url.replace(/^https?:\/\//i, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
}

export function cachedImageUri(url) {
  if (!pending.has(url)) {
    const task = (async () => {
      const { File, Directory, Paths } = require('expo-file-system');
      const dir = new Directory(Paths.cache, 'remote-images');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, cacheName(url));
      if (file.exists && file.size > 0) return file.uri;
      const downloaded = await File.downloadFileAsync(url, file, { idempotent: true });
      return downloaded.uri;
    })();
    // A failed download must not be remembered; the next render retries.
    task.catch(() => pending.delete(url));
    pending.set(url, task);
  }
  return pending.get(url);
}

export default function RemoteImage({ uri, ...props }) {
  const remote = Platform.OS !== 'web' && typeof uri === 'string' && /^https?:\/\//i.test(uri);
  const [localUri, setLocalUri] = useState(null);

  useEffect(() => {
    if (!remote) return undefined;
    let live = true;
    setLocalUri(null);
    cachedImageUri(uri)
      .then((local) => { if (live) setLocalUri(local); })
      // Fall back to the remote URL rather than showing nothing.
      .catch(() => { if (live) setLocalUri(uri); });
    return () => { live = false; };
  }, [uri, remote]);

  const shown = remote ? localUri : uri;
  return <Image {...props} source={shown ? { uri: shown } : undefined} />;
}
