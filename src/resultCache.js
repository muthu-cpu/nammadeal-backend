/**
 * In-memory cache for ONDC search responses.
 * Stores results keyed by transactionId until the app polls for them.
 * (In production, replace with Firestore for persistence)
 */

const cache = new Map(); // transactionId → { results: [], updatedAt: Date }

const TTL_MS = 5 * 60 * 1000; // 5 minutes

function store(transactionId, providerResults) {
  const existing = cache.get(transactionId) || { results: [] };
  // Merge all on_search callbacks (ONDC sends one per seller)
  existing.results.push(...(Array.isArray(providerResults) ? providerResults : [providerResults]));
  existing.updatedAt = new Date();
  cache.set(transactionId, existing);
}

function get(transactionId) {
  const entry = cache.get(transactionId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > TTL_MS) {
    cache.delete(transactionId);
    return null;
  }
  return entry.results;
}

function clear(transactionId) {
  cache.delete(transactionId);
}

// Clean up expired entries every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of cache.entries()) {
    if (now - val.updatedAt > TTL_MS) cache.delete(key);
  }
}, 10 * 60 * 1000);

module.exports = { store, get, clear };
