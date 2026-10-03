import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildDeliveryTrackingHtml } from '../lib/deliveryTrackingHtml';
import { scriptJson } from '../lib/trackingGeometry';
import { mapPayload } from '../lib/mapPayload';
import { tr } from '../i18n/translate';
import { MAP_PAGE_BASE_URL, isMapPageLoad } from '../lib/mapPageOrigin';

export default function DeliveryMapFrame({ data, onEvent }) {
  const ref = useRef(null), sent = useRef({});
  const [ready, setReady] = useState(false);
  const source = useMemo(() => ({ html: buildDeliveryTrackingHtml(), baseUrl: MAP_PAGE_BASE_URL }), []);
  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.updateDeliveryMap && window.updateDeliveryMap(${scriptJson(mapPayload(data, sent.current))});true;`);
  }, [data, ready]);
  // Android ends the whole app when a WebView's renderer process dies (memory
  // pressure) unless this is handled; report it so the screen can reload the map.
  const gone = () => { setReady(false); onEvent({ type: 'error', message: tr('misc.mapUnavailable') }); };
  return <WebView ref={ref} source={source} style={{ flex: 1 }} javaScriptEnabled cacheEnabled
    originWhitelist={['*']} applicationNameForUserAgent="VeggieTrack/1.0" setSupportMultipleWindows={false}
    onShouldStartLoadWithRequest={request => {
      if (isMapPageLoad(request.url)) return true;
      if (/^https?:/.test(request.url) && request.isTopFrame !== false) { Linking.openURL(request.url).catch(() => {}); return false; }
      return true;
    }}
    onLoadStart={() => setReady(false)}
    onRenderProcessGone={gone} onContentProcessDidTerminate={gone}
    onMessage={event => {
      try { const message = JSON.parse(event.nativeEvent.data);
        if (message.channel !== 'veggietrack-map') return;
        // A freshly loaded page has drawn nothing yet, so the next update carries the route.
        if (message.type === 'ready') { sent.current = {}; setReady(true); }
        onEvent(message);
      } catch { /* Ignore non-map messages. */ }
    }} onError={() => onEvent({ type: 'error', message: tr('misc.mapUnavailable') })} />;
}
