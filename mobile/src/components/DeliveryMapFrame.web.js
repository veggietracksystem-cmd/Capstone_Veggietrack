import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildDeliveryTrackingHtml } from '../lib/deliveryTrackingHtml';

export default function DeliveryMapFrame({ data, onEvent }) {
  const ref = useRef(null), callback = useRef(onEvent);
  callback.current = onEvent;
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildDeliveryTrackingHtml(), []);
  useEffect(() => {
    const listener = event => {
      if (event.source !== ref.current?.contentWindow || event.data?.channel !== 'veggietrack-map') return;
      if (event.data.type === 'ready') setReady(true);
      callback.current(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (ready) ref.current?.contentWindow?.postMessage({ channel: 'veggietrack-map', type: 'update', data }, '*');
  }, [data, ready]);
  return <iframe ref={ref} title="Live delivery tracking map" srcDoc={html}
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin"
    style={{ border: 0, width: '100%', height: '100%', minHeight: 220, flex: 1 }} />;
}
