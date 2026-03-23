const { searchFood } = require('../services/food/foodAggregator.service');

async function searchFoodController(req, res, next) {
  try {
    const { q, lat, lng } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    const payload = await searchFood(q, {
      lat: Number(lat || 0),
      lng: Number(lng || 0),
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
}

function getTrendingFood(_req, res) {
  res.json({
    city: 'bengaluru',
    items: ['Biryani', 'Dosa', 'Shawarma', 'Meals', 'Burger'],
    updatedAt: new Date().toISOString(),
  });
}

module.exports = {
  searchFoodController,
  getTrendingFood,
};
