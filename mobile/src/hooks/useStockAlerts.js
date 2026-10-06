import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import useRefreshOnFocus from './useRefreshOnFocus';

/**
 * Distributor stock alerts (7-day stock rule): batches with stock from day 7 in
 * stock that still wait for a decision, from GET /api/distributor/stock-alerts.
 * From day 8 an alert is "Needs Review" (past_limit). Alerts are warnings only:
 * the stock stays on sale until the distributor discards it. Home shows the count
 * on its Stock Alert shortcut; Stocks marks and filters the batches.
 * Reloads on focus, so resolving a batch in Stocks lowers the Home count.
 */
export default function useStockAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await api.get('/api/distributor/stock-alerts');
      setAlerts(Array.isArray(list) ? list : []);
    } catch { /* The screen stays usable when alerts cannot load. */ }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useRefreshOnFocus(reload);

  // Keep/Sell: saved on the server, so every screen and device stops alerting.
  // The stock stays in the batch and on sale. Throws when the save fails.
  const keep = useCallback(async (batchId) => {
    await api.post(`/api/products/${batchId}/keep`);
    setAlerts((current) => current.filter((alert) => alert.batch_id !== batchId));
  }, []);

  return { alerts, loaded, reload, keep };
}
