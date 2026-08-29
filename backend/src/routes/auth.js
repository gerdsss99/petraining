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
    const account = await models.findAccountByUsernameOrBadge(username?.trim());

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

// Reached two ways: forced (mustChangePassword — a temp password from the
// Onboard New Employee flow or a fresh Login Account) with no way around it
// until it's done, or voluntary (the "Change Password" link any signed-in
// account can use any time). Either way clears mustChangePassword on success.
router.get('/change-password', (req, res) => {
  if (!req.currentUser) return res.redirect('/login');
  res.render('change-password', {
    title: 'Change Password',
    forced: req.currentUser.mustChangePassword,
    error: null,
  });
});

router.post('/change-password', async (req, res, next) => {
  try {
    if (!req.currentUser) return res.redirect('/login');
    const forced = req.currentUser.mustChangePassword;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    function fail(error) {
      res.status(400).render('change-password', { title: 'Change Password', forced, error });
    }

    if (!(await bcrypt.compare(currentPassword || '', req.currentUser.passwordHash))) {
      return fail(forced ? 'That temporary password is incorrect.' : 'Your current password is incorrect.');
    }
    if (!newPassword || newPassword.length < 6) {
      return fail('New password must be at least 6 characters.');
    }
    if (newPassword !== confirmPassword) {
      return fail('New password and confirmation do not match.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await models.setAccountPassword(req.currentUser.id, passwordHash);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
