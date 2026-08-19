const express = require('express');
const models = require('../lib/models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const people = await models.searchEmployees(q);
    res.render('person/list', { title: 'Person Lookup', people, q });
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
