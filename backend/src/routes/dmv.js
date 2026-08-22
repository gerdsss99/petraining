const express = require('express');
const models = require('../lib/models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// No results list — searching a plate jumps straight to the vehicle page,
// or shows an error on the same search page if nothing matches.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.render('dmv/search', { title: 'DMV Database', q, error: null });
    }

    const vehicle = await models.findVehicleByPlate(q);
    if (vehicle) {
      return res.redirect(`/dmv/${vehicle.id}`);
    }

    res.render('dmv/search', { title: 'DMV Database', q, error: `No vehicle found with plate "${q}".` });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const vehicle = await models.getVehicleFull(id);

    if (!vehicle) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No vehicle with that ID.' });
    }

    res.render('dmv/detail', { title: vehicle.model, vehicle });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
