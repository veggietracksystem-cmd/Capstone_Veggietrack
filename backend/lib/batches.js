// Batch lifecycle and FIFO rules for the `products` table. Each row is one
// batch; batches whose names share a vegetableKey() form one product.
//
//   received  in Stocks, not yet sellable
//   listed    sellable while stock_kg > 0
//   sold_out  stock reached 0 (history only)
//   archived  removed from the Product List (history only)
//
// Completed batches never return to received/listed, except when an order
// cancellation restores stock to its original batch (restore_product_stock).
const { vegetableKey, canonicalVegetableName } = require('./vegetables');

const COMPLETED_STATUSES = ['sold_out', 'archived'];

// Round to the gram to avoid floating-point residue after repeated splits.
const roundKg = (value) => Math.round(Number(value) * 1000) / 1000;
const stockOf = (batch) => (Number.isFinite(Number(batch?.stock_kg)) ? Number(batch.stock_kg) : 0);

// In the warehouse; rows without a status count as received.
function isActiveBatch(batch) {
  return stockOf(batch) > 0 && !COMPLETED_STATUSES.includes(batch.status);
}
function isReceivedBatch(batch) {
  return isActiveBatch(batch) && batch.status !== 'listed';
}
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
// count toward stock, so a fully sold-out vegetable remains as a 0 kg entry.
// In-stock vegetables are listed first.
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
      sellable,
    };
  });
  return [...products.filter((p) => p.available_kg > 0), ...products.filter((p) => !(p.available_kg > 0))];
}

// Retailer entry: no batch id, farmer or dates; photos of batches on sale, oldest first.
function retailerProducts(batches) {
  return groupProducts(batches).map(({ vegetable_name, price_per_kg, available_kg, sellable }) => {
    const batch_photos = [...new Set(sellable.map((batch) => batch.batch_photo_url).filter(Boolean))];
    return { vegetable_name, price_per_kg, available_kg, batch_photo_url: batch_photos[0] || null, batch_photos };
  });
}

// Distributor entry. `id` is any batch of the vegetable; the price, quantity and
// remove routes apply to every batch sharing its name.
function distributorListings(batches) {
  return groupProducts(batches).map(({ id, vegetable_name, price_per_kg, available_kg }) => ({
    id, vegetable_name, price_per_kg, available_kg, status: available_kg > 0 ? 'Listed' : 'Sold Out',
  }));
}

function batchStatus(batch) {
  if (COMPLETED_STATUSES.includes(batch.status)) return batch.status;
  if (stockOf(batch) <= 0) return 'sold_out';
  return batch.status === 'listed' ? 'listed' : 'received';
}

// A 'YYYY-MM-DD' date is a Philippine calendar day, stored at noon Manila time so
// it never shifts across time zones. Returns null for an invalid date.
function batchDate(value) {
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const day = new Date(`${match[0]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[0]) return null;
  return { day: match[0], iso: new Date(`${match[0]}T12:00:00+08:00`).toISOString() };
}
const manilaToday = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

module.exports = {
  COMPLETED_STATUSES, roundKg, isActiveBatch, isReceivedBatch, isSellableBatch, isOnProductList,
  compareFifo, sameVegetableAs, planFifoDraw, retailerProducts, distributorListings, batchStatus,
  batchDate, manilaToday,
};
