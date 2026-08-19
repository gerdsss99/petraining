const express = require('express');
const models = require('../lib/models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const vehicles = await models.searchVehicles(q);
    res.render('dmv/list', { title: 'DMV Database', vehicles, q });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
