const axios = require('axios');

async function searchLocations(req, res, next) {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.json({
        source: 'fallback',
        items: [
          { placeId: 'majestic', title: 'Majestic, Bengaluru', subtitle: 'Kempegowda Bus Station', lat: 12.9784, lng: 77.5720 },
          { placeId: 'whitefield', title: 'Whitefield, Bengaluru', subtitle: 'IT corridor', lat: 12.9698, lng: 77.7500 },
          { placeId: 'indiranagar', title: 'Indiranagar, Bengaluru', subtitle: 'East Bengaluru', lat: 12.9784, lng: 77.6408 },
        ].filter((item) => item.title.toLowerCase().includes(String(q).toLowerCase())),
      });
    }

    const response = await axios.post(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        input: q,
        includedRegionCodes: ['in'],
      },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
      }
    );

    const items = (response.data.suggestions || []).map((suggestion) => {
      const place = suggestion.placePrediction || {};
      return {
        placeId: place.placeId || '',
        title: place.text?.text || '',
        subtitle: place.structuredFormat?.secondaryText?.text || '',
      };
    });

    return res.json({ source: 'google', items });
  } catch (error) {
    return next(error);
  }
}

function searchFoods(req, res) {
  const query = String(req.query.q || '').trim().toLowerCase();
  const catalog = ['biryani', 'dosa', 'shawarma', 'idli', 'meals', 'burger', 'pizza'];
  const items = catalog
    .filter((item) => item.includes(query))
    .map((item) => ({
      id: item,
      label: item.charAt(0).toUpperCase() + item.slice(1),
      kind: 'food',
    }));

  res.json({
    city: 'bengaluru',
    items,
    trending: ['Biryani', 'Dosa', 'Shawarma'],
  });
}

module.exports = {
  searchLocations,
  searchFoods,
};
