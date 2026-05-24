const memoryCache = new Map();

function cacheKey(parts) {
  return Array.isArray(parts) ? parts.map((part) => String(part)).join('::') : String(parts);
}

function getCachedValue(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue(key, value, ttlMs = 5000) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(0, Number(ttlMs) || 0)
  });
  return value;
}

function getOrSetCachedValue(key, factory, ttlMs = 5000) {
  const existing = getCachedValue(key);
  if (existing !== null) return Promise.resolve(existing);

  const result = Promise.resolve().then(factory);
  return result.then((value) => setCachedValue(key, value, ttlMs));
}

function invalidateCache(prefix = '') {
  const needle = String(prefix);
  for (const key of memoryCache.keys()) {
    if (!needle || String(key).startsWith(needle)) {
      memoryCache.delete(key);
    }
  }
}

module.exports = {
  cacheKey,
  getCachedValue,
  setCachedValue,
  getOrSetCachedValue,
  invalidateCache
};