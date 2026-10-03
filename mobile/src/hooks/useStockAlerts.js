import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { kvGet, kvSet } from '../offline/db';
import useRefreshOnFocus from './useRefreshOnFocus';

// Batches the distributor chose to keep selling; they are not alerted again.
const KEEP_SELLING_KEY = 'stock_alerts_keep_selling';

/**
 * Distributor stock alerts (7-day stock rule): batches on their 7th day in stock
 * that still have stock, from GET /api/distributor/stock-alerts. Home shows the
 * count on its Stock Alert shortcut; Stocks marks and filters the batches.
 * Reloads on focus, so resolving a batch in Stocks lowers the Home count.
 */
export default function useStockAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [keepSelling, setKeepSelling] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [list, kept] = await Promise.all([api.get('/api/distributor/stock-alerts'), kvGet(KEEP_SELLING_KEY).catch(() => null)]);
      setAlerts(Array.isArray(list) ? list : []);
      setKeepSelling(Array.isArray(kept) ? kept : []);
    } catch { /* The screen stays usable when alerts cannot load. */ }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useRefreshOnFocus(reload);

  const keep = useCallback(async (batchId) => {
    // Only batches still alerted are remembered, so the list never grows.
    const next = [...keepSelling.filter((id) => id !== batchId && alerts.some((a) => a.batch_id === id)), batchId];
    setKeepSelling(next);
    await kvSet(KEEP_SELLING_KEY, next).catch(() => {});
  }, [alerts, keepSelling]);

  return { alerts: alerts.filter((alert) => !keepSelling.includes(alert.batch_id)), loaded, reload, keep };
}
