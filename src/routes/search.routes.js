const express = require('express');
const { searchLocations, searchFoods } = require('../controllers/search.controller');

const router = express.Router();

router.get('/locations', searchLocations);
router.get('/foods', searchFoods);

module.exports = router;
