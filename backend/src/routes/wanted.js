const express = require('express');
const models = require('../lib/models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const entries = await models.getActiveWantedEntries();
    res.render('wanted/list', { title: 'Wanted Database', entries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
