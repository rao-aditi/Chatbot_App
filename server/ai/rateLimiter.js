// In-memory sliding-window limiter. Fine for a single server process; use a
// shared store (e.g. Redis) if the backend is scaled horizontally.
function createRateLimiter(max, windowMs) {
  const hits = new Map();

  return function allow(key) {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

module.exports = { createRateLimiter };
