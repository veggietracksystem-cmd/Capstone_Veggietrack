// Batch lifecycle and FIFO rules for the `products` table. Each row is one
// batch; batches whose names share a vegetableKey() form one product.
//
//   received  in Stocks, not yet sellable
//   listed    sellable while stock_kg > 0, at any age (see isPastSpoilageLimit)
//   sold_out  stock reached 0 (history only)
//   archived  removed from the Product List (history only)
//   spoiled   remaining stock moved to Spoiled Products (history only)
//
// Completed batches never return to received/listed, except when an order
// cancellation restores stock to its original batch (restore_product_stock).
const { vegetableKey, canonicalVegetableName } = require('./vegetables');

const COMPLETED_STATUSES = ['sold_out', 'archived', 'spoiled'];

// Stock columns store hundredths of a kilogram.
const roundKg = (value) => Math.round(Number(value) * 100) / 100;
const hasStockPrecision = (value) => Number.isFinite(Number(value))
  && Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 1e-7;
const stockOf = (batch) => (Number.isFinite(Number(batch?.stock_kg)) ? Number(batch.stock_kg) : 0);

// A missing status is a legacy received batch; unknown statuses stay inactive.
function isActiveBatch(batch) {
  return stockOf(batch) > 0 && (batch.status == null || ['received', 'listed'].includes(batch.status));
}
function isReceivedBatch(batch) {
  return isActiveBatch(batch) && batch.status !== 'listed';
}
// Listed stock that remains. Age never takes stock out of sale: past the 7-day
// limit it is flagged for review (needsSpoilageReview) and stays sellable until
// the distributor discards it, so "Out of Stock" always means 0 kg left.
function isSellableBatch(batch) {
  return batch.status === 'listed' && stockOf(batch) > 0;
}
// On the Product List: listed, or listed until it sold out.
function isOnProductList(batch) {
  return batch.status === 'listed' || batch.status === 'sold_out';
}

const timeOf = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Infinity;
};

// FIFO: oldest harvest date first, then creation time, then id for a stable order.
function compareFifo(a, b) {
  return (timeOf(a.harvest_date) - timeOf(b.harvest_date))
    || (timeOf(a.created_at) - timeOf(b.created_at))
    || String(a.id).localeCompare(String(b.id));
}

function sameVegetableAs(name) {
  const key = vegetableKey(name);
  return (batch) => vegetableKey(batch.vegetable_name) === key;
}

// Splits `quantity` across the sellable batches, oldest first. `draws` is null
// when the sellable total cannot cover the quantity.
function planFifoDraw(batches, quantity) {
  const sellable = batches.filter(isSellableBatch).sort(compareFifo);
  const available = roundKg(sellable.reduce((sum, batch) => sum + stockOf(batch), 0));
  let remaining = roundKg(quantity);
  if (!(remaining > 0) || available < remaining) return { available, draws: null };
  const draws = [];
  for (const batch of sellable) {
    if (remaining <= 0) break;
    const take = roundKg(Math.min(remaining, stockOf(batch)));
    draws.push({ batch, quantity_kg: take });
    remaining = roundKg(remaining - take);
  }
  return { available, draws };
}

// One entry per vegetable across its Product List batches. Only sellable batches
// count toward stock, so a fully sold-out vegetable is a 0 kg entry (kept on the
// distributor's Product List as Sold Out). In-stock vegetables are listed first.
// The Product List, Stocks and the retailer catalogue all count stock this way.
function groupProducts(batches) {
  const groups = new Map();
  for (const batch of batches.filter(isOnProductList).sort(compareFifo)) {
    const key = vegetableKey(batch.vegetable_name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(batch);
  }
  const products = [...groups.values()].map((group) => {
    const sellable = group.filter(isSellableBatch);
    // Price of the next kg sold (the first FIFO batch), or the latest price when sold out.
    const priced = sellable[0] || group[group.length - 1];
    return {
      id: priced.id,
      vegetable_name: canonicalVegetableName(priced.vegetable_name),
      price_per_kg: priced.price_per_kg,
      available_kg: roundKg(sellable.reduce((sum, batch) => sum + stockOf(batch), 0)),
      needs_review: sellable.some((batch) => needsSpoilageReview(batch)),
      sellable,
    };
  });
  return [...products.filter((p) => p.available_kg > 0), ...products.filter((p) => !(p.available_kg > 0))];
}

// Retailer entry: no batch id, farmer or dates; photos of batches on sale, oldest
// first. Only vegetables with sellable stock are offered; sold-out ones leave the list.
function retailerProducts(batches) {
  return groupProducts(batches).filter((product) => product.available_kg > 0).map(({ vegetable_name, price_per_kg, available_kg, sellable }) => {
    const batch_photos = [...new Set(sellable.map((batch) => batch.batch_photo_url).filter(Boolean))];
    return { vegetable_name, price_per_kg, available_kg, batch_photo_url: batch_photos[0] || null, batch_photos };
  });
}

// Distributor entry. `id` is any batch of the vegetable; the price, quantity and
// remove routes apply to every batch sharing its name.
function distributorListings(batches) {
  return groupProducts(batches).map(({ id, vegetable_name, price_per_kg, available_kg, needs_review }) => ({
    id, vegetable_name, price_per_kg, available_kg, status: available_kg > 0 ? 'Listed' : 'Sold Out', needs_review,
  }));
}

function batchStatus(batch) {
  if (batch.status != null && !['received', 'listed'].includes(batch.status)) return batch.status;
  if (stockOf(batch) <= 0) return 'sold_out';
  return batch.status === 'listed' ? 'listed' : 'received';
}

// Store a Philippine calendar day at noon Manila time.
function batchDate(value) {
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const day = new Date(`${match[0]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[0]) return null;
  return { day: match[0], iso: new Date(`${match[0]}T12:00:00+08:00`).toISOString() };
}
const manilaToday = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

// 7-day stock rule, the same as sql/keep_past_limit_stock.sql: days are Philippine
// calendar days since the batch entered distributor stock. Day 7 is the last day
// before the limit, when the distributor is alerted. From day 8 the batch is past
// the spoilage limit and "Needs Review". Both are warnings only: the stock stays
// in the batch and on sale. The distributor decides: Keep/Sell clears the warning
// (keepForSaleStage), Discard moves the stock to Spoiled Products.
const STOCK_ALERT_DAYS = 7;
const manilaDayNumber = (time) => Math.floor((time + 8 * 3600000) / 86400000);
const stockSince = (batch) => batch?.pickup_date || batch?.created_at || null;
function daysInStock(batch, now = Date.now()) {
  const since = stockSince(batch);
  const time = since == null ? NaN : new Date(since).getTime();
  return Number.isFinite(time) ? manilaDayNumber(now) - manilaDayNumber(time) : null;
}
// Active stock from day 8, whether or not the distributor has reviewed it.
function isPastSpoilageLimit(batch, now = Date.now()) {
  const days = daysInStock(batch, now);
  return isActiveBatch(batch) && days != null && days > STOCK_ALERT_DAYS;
}
// Alert stage of a batch on a given day: 0 none, 1 last day (day 7), 2 past the limit.
const alertStage = (days) => (days == null || days < STOCK_ALERT_DAYS ? 0 : days === STOCK_ALERT_DAYS ? 1 : 2);
// Stage the distributor's Keep/Sell answered, or 0. A Keep on day 7 does not
// answer the spoilage review that starts on day 8.
function keepForSaleStage(batch) {
  const kept = batch?.kept_for_sale_at == null ? NaN : new Date(batch.kept_for_sale_at).getTime();
  return Number.isFinite(kept) ? alertStage(daysInStock(batch, kept)) : 0;
}
// Unsold stock from day 7 that still waits for the distributor's decision.
function needsStockAlert(batch, now = Date.now()) {
  const stage = alertStage(daysInStock(batch, now));
  return isActiveBatch(batch) && stage > 0 && keepForSaleStage(batch) < stage;
}
// "Needs Review": past the spoilage limit and not yet kept or discarded.
function needsSpoilageReview(batch, now = Date.now()) {
  return isPastSpoilageLimit(batch, now) && needsStockAlert(batch, now);
}

module.exports = {
  COMPLETED_STATUSES, roundKg, hasStockPrecision, isActiveBatch, isReceivedBatch, isSellableBatch, isOnProductList,
  compareFifo, sameVegetableAs, planFifoDraw, retailerProducts, distributorListings, batchStatus,
  batchDate, manilaToday, STOCK_ALERT_DAYS, stockSince, daysInStock, needsStockAlert, isPastSpoilageLimit,
  needsSpoilageReview,
};
