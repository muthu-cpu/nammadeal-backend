const store = new Map();

function getEntry(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function setEntry(key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

function deleteEntry(key) {
  store.delete(key);
}

function buildCacheKey(parts) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).trim().toLowerCase())
    .join(':');
}

module.exports = {
  getEntry,
  setEntry,
  deleteEntry,
  buildCacheKey,
};
