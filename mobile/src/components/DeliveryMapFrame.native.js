import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildDeliveryTrackingHtml } from '../lib/deliveryTrackingHtml';
import { scriptJson } from '../lib/trackingGeometry';

export default function DeliveryMapFrame({ data, onEvent }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const source = useMemo(() => ({ html: buildDeliveryTrackingHtml() }), []);
  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.updateDeliveryMap && window.updateDeliveryMap(${scriptJson(data)});true;`);
  }, [data, ready]);
  return <WebView ref={ref} source={source} style={{ flex: 1 }} javaScriptEnabled cacheEnabled
    originWhitelist={['*']} applicationNameForUserAgent="VeggieTrack/1.0" setSupportMultipleWindows={false}
    onShouldStartLoadWithRequest={request => {
      if (/^https?:/.test(request.url) && request.isTopFrame !== false) { Linking.openURL(request.url).catch(() => {}); return false; }
      return true;
    }}
    onLoadStart={() => setReady(false)}
    onMessage={event => {
      try { const message = JSON.parse(event.nativeEvent.data);
        if (message.channel !== 'veggietrack-map') return;
        if (message.type === 'ready') setReady(true);
        onEvent(message);
      } catch { /* Ignore non-map messages. */ }
    }} onError={() => onEvent({ type: 'error', message: 'Map unavailable. Check your connection.' })} />;
}
