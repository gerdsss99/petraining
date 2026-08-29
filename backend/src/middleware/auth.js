const models = require('../lib/models');

// Loads the logged-in account (with linked in-character Employee profile,
// if any) onto req.currentUser / res.locals.currentUser for every request.
async function loadCurrentUser(req, res, next) {
  try {
    if (req.session && req.session.accountId) {
      req.currentUser = await models.findAccountById(req.session.accountId);
    } else {
      req.currentUser = null;
    }
    res.locals.currentUser = req.currentUser;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser) {
    return res.redirect('/login');
  }
  if (req.currentUser.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Your account does not have Administrator access.',
    });
  }
  next();
}

// An account created with a one-time temp password (see the "Onboard New
// Employee" flow, or any Login Account with a temp password) has
// mustChangePassword set. This gate sits in front of every route and sends
// that account straight to the change-password screen — logged in, but
// unable to do anything else — until they've set their own password.
function requirePasswordChange(req, res, next) {
  if (req.currentUser && req.currentUser.mustChangePassword) {
    const allowedPaths = ['/change-password', '/logout'];
    if (!allowedPaths.includes(req.path)) {
      return res.redirect('/change-password');
    }
  }
  next();
}

module.exports = { loadCurrentUser, requireAuth, requireAdmin, requirePasswordChange };
