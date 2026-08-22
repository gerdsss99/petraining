const express = require('express');
const models = require('../lib/models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// No results list — searching jumps straight to the matching profile (like
// the reference MDC), or shows an error on the same search page if nothing
// matches.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.render('person/search', { title: 'Person Lookup', q, error: null });
    }

    const result = await models.findEmployeeByQuery(q);
    if (result.status === 'found') {
      return res.redirect(`/person/${result.id}`);
    }

    const error =
      result.status === 'ambiguous'
        ? `Multiple people match "${q}" — try their full first and last name.`
        : `No person found matching "${q}".`;

    res.render('person/search', { title: 'Person Lookup', q, error });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const person = await models.getEmployeeFull(id);

    if (!person) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No profile with that ID.' });
    }

    res.render('person/profile', { title: `${person.firstName} ${person.lastName}`, person });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
