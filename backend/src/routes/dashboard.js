const express = require('express');
const models = require('../lib/models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const stats = await models.getDashboardStats();
    res.render('dashboard', { title: 'Dashboard', stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
