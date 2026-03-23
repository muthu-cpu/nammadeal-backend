const { buildCacheKey, getEntry, setEntry } = require('../cache/memoryCache.service');

const FOOD_TTL_MS = 3 * 60 * 1000;

function buildProviderPayload(provider, query, restaurantSlug, price, deliveryFee) {
  const encoded = encodeURIComponent(query);
  const providerKey = provider.toLowerCase();
  const deepLink = providerKey === 'zomato'
    ? `zomato://search?q=${encoded}`
    : `swiggy://search?q=${encoded}`;
  const storeUrl = providerKey === 'zomato'
    ? 'https://play.google.com/store/apps/details?id=com.application.zomato'
    : 'https://play.google.com/store/apps/details?id=in.swiggy.android';

  return {
    provider: providerKey,
    restaurantSlug,
    price,
    deliveryFee,
    deepLink,
    storeUrl,
  };
}

async function searchFood(query, location) {
  const cacheKey = buildCacheKey(['food', query, location?.lat?.toFixed?.(2), location?.lng?.toFixed?.(2)]);
  const cached = getEntry(cacheKey);
  if (cached) {
    return cached;
  }

  const normalizedQuery = String(query || '').trim();
  const title = normalizedQuery.charAt(0).toUpperCase() + normalizedQuery.slice(1).toLowerCase();

  const results = [
    {
      restaurantId: 'blr-ambur-star',
      restaurantName: 'Ambur Star Biryani',
      itemName: title,
      distanceMeters: 1300,
      rating: 4.3,
      providers: [
        buildProviderPayload('zomato', title, 'ambur-star-biryani', 219, 29),
        buildProviderPayload('swiggy', title, 'ambur-star-biryani', 229, 25),
      ],
    },
    {
      restaurantId: 'blr-meghana-foods',
      restaurantName: 'Meghana Foods',
      itemName: title,
      distanceMeters: 1900,
      rating: 4.5,
      providers: [
        buildProviderPayload('zomato', title, 'meghana-foods', 249, 35),
        buildProviderPayload('swiggy', title, 'meghana-foods', 239, 42),
      ],
    },
    {
      restaurantId: 'blr-a2b',
      restaurantName: 'A2B',
      itemName: title,
      distanceMeters: 2400,
      rating: 4.1,
      providers: [
        buildProviderPayload('zomato', title, 'a2b', 189, 22),
        buildProviderPayload('swiggy', title, 'a2b', 194, 19),
      ],
    },
  ].sort((left, right) => {
    const leftBest = Math.min(...left.providers.map((provider) => provider.price + provider.deliveryFee));
    const rightBest = Math.min(...right.providers.map((provider) => provider.price + provider.deliveryFee));
    return leftBest - rightBest;
  });

  return setEntry(cacheKey, {
    results,
    source: 'aggregated-fallback',
    cachedAt: new Date().toISOString(),
  }, FOOD_TTL_MS);
}

module.exports = {
  searchFood,
};
