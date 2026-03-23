const express = require('express');
const { resolveDeepLink } = require('../controllers/deeplink.controller');

const router = express.Router();

router.post('/resolve', resolveDeepLink);

module.exports = router;
