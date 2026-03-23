const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'NammaDeal API v1',
    time: new Date().toISOString(),
  });
});

module.exports = router;
