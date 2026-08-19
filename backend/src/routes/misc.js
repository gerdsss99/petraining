const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/maps', requireAuth, (req, res) => {
  res.render('maps', { title: 'Maps' });
});

router.get('/miscellaneous', requireAuth, (req, res) => {
  res.render('misc', { title: 'Miscellaneous' });
});

router.get('/changelog', requireAuth, (req, res) => {
  const entries = [
    { version: '1.2.0', date: '2026-08-01', notes: ['Added Wanted Database', 'Added Admin profile editor'] },
    { version: '1.1.0', date: '2026-07-10', notes: ['Added DMV Database lookup', 'Styling pass on Person profile'] },
    { version: '1.0.0', date: '2026-06-20', notes: ['Initial training MDC replica release'] },
  ];
  res.render('changelog', { title: 'Changelog', entries });
});

module.exports = router;
