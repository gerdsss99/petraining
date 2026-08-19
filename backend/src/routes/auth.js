const express = require('express');
const bcrypt = require('bcryptjs');
const models = require('../lib/models');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.currentUser) return res.redirect('/');
  res.render('login', { title: 'Login', error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const account = await models.findAccountByUsername(username?.trim());

    if (!account || !(await bcrypt.compare(password || '', account.passwordHash))) {
      return res.status(401).render('login', {
        title: 'Login',
        error: 'Invalid username or password.',
      });
    }

    req.session.accountId = account.id;
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
