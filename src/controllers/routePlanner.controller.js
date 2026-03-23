const { buildCacheKey, getEntry, setEntry } = require('../services/cache/memoryCache.service');
const {
  fetchGoogleTransitRoutes,
  buildFallbackRoutes,
  DEFAULT_TTL_MS,
} = require('../services/google/routes.service');

function sortRoutes(routes, sortBy) {
  const sorted = [...routes];
  if (sortBy === 'cheapest') {
    sorted.sort((left, right) => left.costInr - right.costInr || left.durationMin - right.durationMin);
    return sorted;
  }
  if (sortBy === 'least_walking') {
    sorted.sort((left, right) => left.walkingMeters - right.walkingMeters || left.durationMin - right.durationMin);
    return sorted;
  }
  sorted.sort((left, right) => left.durationMin - right.durationMin || left.costInr - right.costInr);
  return sorted;
}

async function planRoutes(req, res, next) {
  try {
    const { origin, destination, filters = {}, departureTime = null } = req.body || {};

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return res.status(400).json({ error: 'origin and destination coordinates are required' });
    }

    const sortBy = filters.sortBy || 'fastest';
    const cacheKey = buildCacheKey([
      'routes',
      origin.lat.toFixed(3),
      origin.lng.toFixed(3),
      destination.lat.toFixed(3),
      destination.lng.toFixed(3),
      sortBy,
    ]);

    const cached = getEntry(cacheKey);
    if (cached) {
      return res.json({ ...cached, cacheHit: true });
    }

    const googleRoutes = await fetchGoogleTransitRoutes({ origin, destination, departureTime });
    const routes = googleRoutes.length > 0 ? googleRoutes : buildFallbackRoutes({ origin, destination });
    const payload = {
      cacheKey,
      cacheHit: false,
      sortBy,
      routes: sortRoutes(routes, sortBy),
      generatedAt: new Date().toISOString(),
    };

    setEntry(cacheKey, payload, DEFAULT_TTL_MS);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  planRoutes,
};
