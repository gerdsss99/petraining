const express = require('express');
const models = require('../lib/models');
const { requireAuth } = require('../middleware/auth');
const { parseInfractionNarrative } = require('../lib/narrativeParser');

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

    const { location, confidentialLevel, narrative } = req.body;

    if (!narrative || !narrative.trim()) {
      const penalCodes = await models.listPenalCodes();
      return res.render('person/infraction-new', {
        title: 'Create Infraction Report',
        person,
        penalCodes,
        error: 'A narrative is required.',
      });
    }

    // Pasting the report from the reports site does the real work here —
    // it reads the "Citation(s):"/"Citation Reason(s):" lists for penal
    // codes + fines + reasons, and the <img> tags for evidence photos.
    const parsed = parseInfractionNarrative(narrative);
    for (const c of parsed.codes) {
      if (!c.rawCode) continue;
      const match = await models.findPenalCodeByCode(c.rawCode);
      if (match) c.penalCodeId = match.id;
    }

    // Rows added manually via the PENAL CODE / + INFRACTION buttons (for
    // reports that don't come pre-formatted) get resolved the same way.
    const manualRaw = [].concat(req.body.penalCode || []).map((c) => (c || '').trim()).filter(Boolean);
    const manualCodes = [];
    for (const raw of manualRaw) {
      const match = await models.findPenalCodeByCode(raw);
      if (match) {
        manualCodes.push({ rawCode: match.code, penalCodeId: match.id, title: match.title, fineAmount: match.fineAmount, reasonText: null });
      } else {
        manualCodes.push({ rawCode: null, penalCodeId: null, title: raw, fineAmount: 0, reasonText: null });
      }
    }

    // Picking codes manually via the PENAL CODE / + INFRACTION buttons is an
    // explicit, deliberate choice of exactly what to file — it overrides
    // whatever the narrative's own "Citation(s):" list happens to contain,
    // rather than adding to it. Without this, a narrative documenting two
    // citations (both real, but only one of which the officer meant to
    // formally charge) would always get both attached regardless of what
    // was picked by hand. The narrative is still used for everything else —
    // the display text and any evidence images — just not for auto-picking
    // codes once the officer has picked their own.
    const seen = new Set();
    const codes = [];
    for (const c of manualRaw.length ? manualCodes : parsed.codes) {
      const key = c.rawCode ? `code:${c.rawCode}` : `label:${c.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      codes.push(c);
    }

    // Every code's final label gets its offense count computed fresh here —
    // "(Second Offense)", "(Third or More Offense)", or nothing for a first
    // offense — based on this person's real prior citation history for that
    // exact code, never on whatever offense wording the pasted report had.
    for (const c of codes) {
      c.codeLabel = await models.buildInfractionCodeLabel(id, c);
    }

    const reportedBy = req.currentUser && req.currentUser.employee
      ? `${req.currentUser.employee.firstName} ${req.currentUser.employee.lastName}`
      : (req.currentUser ? req.currentUser.username : 'Unknown');

    // Filing the report and issuing the citation are treated as one
    // finished action, not a pending case — so every new report is closed
    // on submit. Reopen it later via the Admin panel if a case needs to be
    // revisited.
    await models.createInfractionReport({
      personId: id,
      remark: codes.length ? codes.map((c) => c.codeLabel).join('; ') : 'Infraction Report',
      status: 'Closed',
      location,
      confidentialLevel: confidentialLevel || 'Generic',
      narrative: parsed.displayNarrative,
      reportedBy,
      evidenceUrls: parsed.images.join('\n'),
      codes,
    });

    // No separate confirmation step — submitting is the whole action.
    res.redirect(`/person/${id}`);
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
