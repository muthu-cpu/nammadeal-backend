const PROVIDER_LINKS = {
  zomato: {
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.application.zomato',
    iosStoreUrl: 'https://apps.apple.com/in/app/zomato-food-delivery-dining/id434613896',
  },
  swiggy: {
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=in.swiggy.android',
    iosStoreUrl: 'https://apps.apple.com/in/app/swiggy-food-grocery-delivery/id989540920',
  },
  uber: {
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.ubercab',
    iosStoreUrl: 'https://apps.apple.com/in/app/uber-request-a-ride/id368677368',
  },
};

function resolveDeepLink(req, res) {
  const { provider, deepLink, fallbackUrl } = req.body || {};
  const providerConfig = PROVIDER_LINKS[String(provider || '').toLowerCase()];

  if (!providerConfig && !fallbackUrl) {
    return res.status(400).json({ error: 'provider or fallbackUrl is required' });
  }

  return res.json({
    provider,
    deepLink: deepLink || null,
    fallback: fallbackUrl || providerConfig,
  });
}

module.exports = {
  resolveDeepLink,
};
