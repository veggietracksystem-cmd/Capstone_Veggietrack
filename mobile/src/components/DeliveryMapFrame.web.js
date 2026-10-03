import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDeliveryTrackingHtml } from '../lib/deliveryTrackingHtml';
import { mapPayload } from '../lib/mapPayload';
import { tr } from '../i18n/translate';

export default function DeliveryMapFrame({ data, onEvent }) {
  const ref = useRef(null), callback = useRef(onEvent), sent = useRef({});
  callback.current = onEvent;
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildDeliveryTrackingHtml(), []);
  useEffect(() => {
    const listener = event => {
      if (event.source !== ref.current?.contentWindow || event.data?.channel !== 'veggietrack-map') return;
      if (event.data.type === 'ready') { sent.current = {}; setReady(true); }
      callback.current(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (ready) ref.current?.contentWindow?.postMessage({ channel: 'veggietrack-map', type: 'update', data: mapPayload(data, sent.current) }, '*');
  }, [data, ready]);
  // allow-same-origin keeps the map frame in the app's own process. Without it
  // Chrome runs the sandboxed frame as a separate process that browser touch
  // emulation (DevTools device mode) does not reach, so the map could not be
  // dragged with emulated touch. Leaflet is pinned by integrity hash in the page.
  return <iframe ref={ref} title={tr('misc.trackingMapTitle')} srcDoc={html}
    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin"
    style={{ border: 0, width: '100%', height: '100%', minHeight: 220, flex: 1 }} />;
}
