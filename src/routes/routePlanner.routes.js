const express = require('express');
const { planRoutes } = require('../controllers/routePlanner.controller');

const router = express.Router();

router.post('/plan', planRoutes);

module.exports = router;
