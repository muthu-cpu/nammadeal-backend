const express = require('express');
const { searchFoodController, getTrendingFood } = require('../controllers/food.controller');

const router = express.Router();

router.get('/search', searchFoodController);
router.get('/trending', getTrendingFood);

module.exports = router;
