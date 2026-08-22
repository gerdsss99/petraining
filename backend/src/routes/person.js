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

// ---------------------------------------------------------------------
// Infraction reports — "paste a code from the reports website" is modeled
// as staff typing/pasting a penal code (e.g. "410") which resolves against
// the local PenalCode reference table and gets attached to the report.
// ---------------------------------------------------------------------
router.get('/:id/infractions/new', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [person, penalCodes] = await Promise.all([models.getEmployeeFull(id), models.listPenalCodes()]);
    if (!person) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No profile with that ID.' });
    }
    res.render('person/infraction-new', { title: 'Create Infraction Report', person, penalCodes, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/infractions', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const person = await models.getEmployeeFull(id);
    if (!person) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No profile with that ID.' });
    }

    const { location, status, confidentialLevel, narrative, evidenceUrls } = req.body;
    const rawCodes = [].concat(req.body.penalCode || []).map((c) => (c || '').trim()).filter(Boolean);

    if (!rawCodes.length) {
      const penalCodes = await models.listPenalCodes();
      return res.render('person/infraction-new', {
        title: 'Create Infraction Report',
        person,
        penalCodes,
        error: 'Attach at least one penal code before submitting the report.',
      });
    }

    const codes = [];
    for (const raw of rawCodes) {
      const match = await models.findPenalCodeByCode(raw);
      if (match) {
        codes.push({ penalCodeId: match.id, codeLabel: `${match.code} — ${match.title}`, fineAmount: match.fineAmount });
      } else {
        codes.push({ penalCodeId: null, codeLabel: raw, fineAmount: 0 });
      }
    }

    const reportedBy = req.currentUser && req.currentUser.employee
      ? `${req.currentUser.employee.firstName} ${req.currentUser.employee.lastName}`
      : (req.currentUser ? req.currentUser.username : 'Unknown');

    const infraction = await models.createInfractionReport({
      personId: id,
      remark: codes.map((c) => c.codeLabel).join('; '),
      status: status === 'Closed' ? 'Closed' : 'Open',
      location,
      confidentialLevel: confidentialLevel || 'Public',
      narrative,
      reportedBy,
      evidenceUrls,
      codes,
    });

    res.redirect(`/person/${id}/infractions/${infraction.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/infractions/:infractionId', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const infraction = await models.getInfractionFull(Number(req.params.infractionId));
    if (!infraction || infraction.personId !== id) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No infraction report with that ID.' });
    }
    res.render('person/infraction-view', { title: `Infraction Report #${infraction.id}`, infraction });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Citations — issued separately from (but optionally linked to) an
// infraction report.
// ---------------------------------------------------------------------
router.get('/:id/citations/new', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const person = await models.getEmployeeFull(id);
    if (!person) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No profile with that ID.' });
    }
    const infractionId = req.query.infractionId ? Number(req.query.infractionId) : null;
    const infraction = infractionId ? await models.getInfractionFull(infractionId) : null;
    res.render('person/citation-new', { title: 'Issue Citation', person, infraction, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/citations', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const person = await models.getEmployeeFull(id);
    if (!person) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No profile with that ID.' });
    }

    const { amount, reason, vehiclePlate, streetName, infractionId } = req.body;
    if (!amount || !reason || !reason.trim()) {
      const infraction = infractionId ? await models.getInfractionFull(Number(infractionId)) : null;
      return res.render('person/citation-new', {
        title: 'Issue Citation',
        person,
        infraction,
        error: 'Amount and Reason are required.',
      });
    }

    const issuedById = req.currentUser && req.currentUser.employee ? req.currentUser.employee.id : null;

    await models.createCitation({
      personId: id,
      issuedById,
      amount: parseInt(amount, 10),
      reason: reason.trim(),
      vehiclePlate: vehiclePlate && vehiclePlate.trim() ? vehiclePlate.trim() : null,
      streetName: streetName && streetName.trim() ? streetName.trim() : null,
      infractionId: infractionId ? Number(infractionId) : null,
    });

    res.redirect(infractionId ? `/person/${id}/infractions/${infractionId}` : `/person/${id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
