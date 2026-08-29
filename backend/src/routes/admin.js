const express = require('express');
const bcrypt = require('bcryptjs');
const models = require('../lib/models');
const { requireAdmin } = require('../middleware/auth');
const { generateTempPassword } = require('../lib/passwords');
const {
  generateCitationHistory, randomRecentExpirationDate, generateFakeVin, randomVehicleColor,
} = require('../lib/civilianHistory');

const router = express.Router();
router.use(requireAdmin);

// ---------------------------------------------------------------------
// Generic helpers for the small "child record" resources hanging off a
// person profile (vehicles, citations, phones, licenses, ...). Each entry
// maps the URL segment used under /admin/people/:personId/<segment> to the
// SQL table name and the fields the create form is allowed to submit.
// ---------------------------------------------------------------------
const CHILD_RESOURCES = {
  vehicles: {
    table: 'Vehicle',
    // Vehicle's owner column is "ownerId", not "personId" like every other
    // child table — without this override the generic insert below would
    // try to write a "personId" column that doesn't exist on Vehicle at all.
    ownerColumn: 'ownerId',
    fields: {
      plate: 'string',
      vin: 'string',
      model: 'string',
      color: 'string',
      secondaryColor: 'string',
      vehicleClass: 'string',
      registered: 'boolean',
      insured: 'boolean',
      insuredSince: 'date',
      insuranceExpiredAt: 'date',
      leased: 'boolean',
    },
  },
  citations: {
    table: 'Citation',
    fields: { amount: 'int', reason: 'string', status: 'string', timestamp: 'date' },
  },
  infractions: {
    table: 'Infraction',
    fields: { type: 'string', remark: 'string', status: 'string', timestamp: 'date' },
  },
  warrants: {
    table: 'ArrestWarrant',
    fields: { classification: 'string', charges: 'string', filedBy: 'string', signedBy: 'string', status: 'string' },
  },
  licenses: {
    table: 'License',
    fields: { type: 'string', region: 'string', status: 'string', validUntil: 'date' },
  },
  phones: {
    table: 'Phone',
    fields: { number: 'string', label: 'string' },
  },
  residences: {
    table: 'Residence',
    fields: { address: 'string' },
  },
  garages: {
    table: 'Garage',
    fields: { name: 'string', address: 'string' },
  },
  businesses: {
    table: 'Business',
    fields: { name: 'string', role: 'string' },
  },
  'caution-codes': {
    table: 'CautionCode',
    fields: { code: 'string', detail: 'string' },
  },
};

function coerce(value, type) {
  if (value === undefined || value === null || value === '') {
    return type === 'boolean' ? false : null;
  }
  switch (type) {
    case 'int':
      return parseInt(value, 10);
    case 'boolean':
      return value === 'on' || value === 'true';
    case 'date':
      return new Date(value);
    default:
      return String(value);
  }
}

function buildData(fields, body) {
  const data = {};
  for (const [field, type] of Object.entries(fields)) {
    data[field] = coerce(body[field], type);
  }
  return data;
}

// ---------------------------------------------------------------------
// Admin overview
// ---------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const [allPeople, accounts, departments] = await Promise.all([
      models.listEmployeesForAdmin(),
      models.listAccounts(),
      models.listDepartments(),
    ]);
    // Personnel and civilians are creation-time separate flows now (see
    // "Onboard New Employee" vs "New Civilian Profile" below), so the
    // overview lists them apart too rather than one mixed table.
    const personnel = allPeople.filter((p) => p.isPersonnel);
    const civilians = allPeople.filter((p) => !p.isPersonnel);
    res.render('admin/index', { title: 'Admin', personnel, civilians, accounts, departments });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Employee / person profile CRUD
// ---------------------------------------------------------------------
router.get('/people/new', async (req, res, next) => {
  try {
    const departments = await models.listDepartments();
    res.render('admin/person-form', { title: 'New Profile', person: null, departments, mode: 'full' });
  } catch (err) {
    next(err);
  }
});

// Civilians are a deliberately separate, much shorter flow from onboarding
// personnel below — no badge, rank, department, or login account, just the
// identity fields a training civilian record actually needs, plus (new)
// a one-click vehicle + citation history so an FTO isn't retyping the same
// few traffic-stop basics through several different admin screens.
router.get('/people/new-civilian', async (req, res, next) => {
  try {
    res.render('admin/person-form', {
      title: 'New Civilian Profile', person: null, departments: [], mode: 'civilian', error: null, formData: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/people/civilian', async (req, res, next) => {
  try {
    const {
      firstName, lastName, age, imageUrl,
      vehicleModel, vehiclePlate, vehicleRegistered, insuranceStatus, priorCitations,
    } = req.body;

    const plate = vehiclePlate && vehiclePlate.trim();
    if (plate) {
      const existingVehicle = await models.findVehicleByPlate(plate);
      if (existingVehicle) {
        // Same "hand the whole form back" treatment as the duplicate-username
        // check on Onboard New Employee — a plate collision shouldn't cost
        // the FTO everything else they just typed.
        return res.status(400).render('admin/person-form', {
          title: 'New Civilian Profile',
          person: null,
          departments: [],
          mode: 'civilian',
          error: `Plate "${plate}" is already registered to another vehicle — pick another.`,
          formData: req.body,
        });
      }
    }

    const person = await models.createEmployee({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      age: age ? parseInt(age, 10) : null,
      imageUrl: imageUrl || null,
      badgeNumber: null,
      rankTitle: null,
      isPersonnel: false,
      departmentId: null,
    });

    // The vehicle block is entirely optional — leaving Plate blank means
    // this civilian just doesn't have a car on file. VIN and color aren't
    // asked for at all here (an FTO doing a quick intake has no reason to
    // have one memorized); a clearly-fictional VIN and a random color are
    // filled in automatically and can be corrected later from the vehicle's
    // own edit form if it ever matters.
    let vehiclePlateForCitations = null;
    if (plate) {
      const insuranceExpired = insuranceStatus === 'expired';
      const vehicle = await models.insertRow('Vehicle', {
        plate,
        vin: generateFakeVin(),
        model: (vehicleModel && vehicleModel.trim()) || 'Unknown',
        color: randomVehicleColor(),
        registered: vehicleRegistered === 'on',
        insured: insuranceStatus === 'insured',
        insuredSince: null,
        insuranceExpiredAt: insuranceExpired ? randomRecentExpirationDate() : null,
        leased: false,
        ownerId: person.id,
      });
      vehiclePlateForCitations = vehicle.plate;
    }

    // "One, two, or three previous citations" — each generates a matching
    // pair: an Infraction Record (so it shows up in that panel the same way
    // a real filed report would) and a Citation with a random Paid/Unpaid
    // status, the Infraction's own status mirroring that same coin flip
    // (Closed for Paid, Open for Unpaid) so the two stay in sync.
    const citationCount = Math.min(3, Math.max(0, parseInt(priorCitations, 10) || 0));
    for (const c of generateCitationHistory(citationCount)) {
      const infraction = await models.insertRow('Infraction', {
        personId: person.id,
        type: 'Infraction',
        remark: c.reason,
        status: c.status === 'Paid' ? 'Closed' : 'Open',
        timestamp: c.timestamp,
      });
      await models.insertRow('Citation', {
        personId: person.id,
        issuedById: null,
        amount: c.amount,
        reason: c.reason,
        status: c.status,
        vehiclePlate: vehiclePlateForCitations,
        streetName: null,
        infractionId: infraction.id,
        timestamp: c.timestamp,
      });
    }

    res.redirect(`/admin/people/${person.id}/edit`);
  } catch (err) {
    next(err);
  }
});

async function resolveDepartmentId(departmentName) {
  if (!departmentName || !departmentName.trim()) return null;
  const dept = await models.upsertDepartmentByName(departmentName.trim());
  return dept.id;
}

router.post('/people', async (req, res, next) => {
  try {
    const { firstName, lastName, age, imageUrl, badgeNumber, rankTitle, isPersonnel, departmentName } = req.body;
    const departmentId = await resolveDepartmentId(departmentName);

    const person = await models.createEmployee({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      age: age ? parseInt(age, 10) : null,
      imageUrl: imageUrl || null,
      badgeNumber: badgeNumber ? parseInt(badgeNumber, 10) : null,
      rankTitle: rankTitle || null,
      isPersonnel: isPersonnel === 'on',
      departmentId,
    });

    res.redirect(`/admin/people/${person.id}/edit`);
  } catch (err) {
    next(err);
  }
});

router.get('/people/:id/edit', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [person, departments] = await Promise.all([models.getEmployeeFull(id), models.listDepartments()]);

    if (!person) {
      return res.status(404).render('error', { title: 'Not Found', message: 'No profile with that ID.' });
    }

    res.render('admin/person-form', { title: `Edit ${person.firstName} ${person.lastName}`, person, departments, mode: 'full' });
  } catch (err) {
    next(err);
  }
});

router.put('/people/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { firstName, lastName, age, imageUrl, badgeNumber, rankTitle, isPersonnel, departmentName } = req.body;
    const departmentId = await resolveDepartmentId(departmentName);

    await models.updateEmployee(id, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      age: age ? parseInt(age, 10) : null,
      imageUrl: imageUrl || null,
      badgeNumber: badgeNumber ? parseInt(badgeNumber, 10) : null,
      rankTitle: rankTitle || null,
      isPersonnel: isPersonnel === 'on',
      departmentId,
    });

    res.redirect(`/admin/people/${id}/edit`);
  } catch (err) {
    next(err);
  }
});

router.delete('/people/:id', async (req, res, next) => {
  try {
    await models.deleteEmployee(Number(req.params.id));
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Generic child-record create / delete
// ---------------------------------------------------------------------
// NOTE: these two "wanted" routes must be registered before the generic
// '/people/:personId/:resource' handler below — otherwise Express matches
// the generic route first (":resource" happily captures "wanted") and it
// 404s because "wanted" isn't in CHILD_RESOURCES.
router.post('/people/:personId/wanted', async (req, res, next) => {
  try {
    const personId = Number(req.params.personId);
    const { reason, dangerLevel, postedBy } = req.body;
    await models.upsertWanted(personId, { reason, dangerLevel, postedBy });
    res.redirect(`/admin/people/${personId}/edit`);
  } catch (err) {
    next(err);
  }
});

router.delete('/people/:personId/wanted', async (req, res, next) => {
  try {
    const personId = Number(req.params.personId);
    await models.clearWanted(personId);
    res.redirect(`/admin/people/${personId}/edit`);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Generic child-record create / delete
// ---------------------------------------------------------------------
router.post('/people/:personId/:resource', async (req, res, next) => {
  try {
    const config = CHILD_RESOURCES[req.params.resource];
    if (!config) return res.status(404).render('error', { title: 'Not Found', message: 'Unknown resource.' });

    const personId = Number(req.params.personId);
    const data = buildData(config.fields, req.body);
    data[config.ownerColumn || 'personId'] = personId;

    // A blank "backdate" field means "just use now()" — leaving it as an
    // explicit null would violate the NOT NULL timestamp columns instead.
    if ('timestamp' in data && data.timestamp === null) delete data.timestamp;

    await models.insertRow(config.table, data);
    res.redirect(`/admin/people/${personId}/edit`);
  } catch (err) {
    next(err);
  }
});

router.delete('/:resource/:id/for/:personId', async (req, res, next) => {
  try {
    const config = CHILD_RESOURCES[req.params.resource];
    if (!config) return res.status(404).render('error', { title: 'Not Found', message: 'Unknown resource.' });

    await models.deleteRow(config.table, Number(req.params.id));

    // Delete buttons on the person profile page (admin-only, see profile.ejs)
    // pass ?returnTo=/person/:id so the admin lands back where they were
    // instead of the Admin panel's edit form. Only a same-site path is ever
    // honored, so this can't be used as an open redirect.
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/')
      ? req.query.returnTo
      : `/admin/people/${req.params.personId}/edit`;
    res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Onboard New Employee — the one-stop FTO flow. Creating a personnel
// profile and creating its login account used to be two separate trips
// through two different panels; this does both in a single form, and (when
// a login account is requested) hands back a one-time temporary password
// the FTO gives to the new officer, who is forced to set their own on
// first sign-in. Nothing about this route is reachable by a non-admin.
// ---------------------------------------------------------------------
router.get('/onboard', async (req, res, next) => {
  try {
    const departments = await models.listDepartments();
    res.render('admin/onboard-employee', {
      title: 'Onboard New Employee', departments, result: null, error: null, formData: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/onboard', async (req, res, next) => {
  try {
    const {
      firstName, lastName, age, imageUrl, badgeNumber, rankTitle, departmentName,
      createLogin, username, role,
    } = req.body;

    if (createLogin === 'on' && username && username.trim()) {
      const existing = await models.findAccountByUsername(username.trim());
      if (existing) {
        const departments = await models.listDepartments();
        // Hand the whole submission back so the FTO doesn't have to retype a
        // 10-field form over one taken username — only the username itself
        // needs to change.
        return res.status(400).render('admin/onboard-employee', {
          title: 'Onboard New Employee',
          departments,
          result: null,
          error: `Username "${username.trim()}" is already taken — pick another.`,
          formData: req.body,
        });
      }
    }

    const departmentId = await resolveDepartmentId(departmentName);
    const person = await models.createEmployee({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      age: age ? parseInt(age, 10) : null,
      imageUrl: imageUrl || null,
      badgeNumber: badgeNumber ? parseInt(badgeNumber, 10) : null,
      rankTitle: rankTitle || null,
      isPersonnel: true,
      departmentId,
    });

    let credentials = null;
    if (createLogin === 'on' && username && username.trim()) {
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const account = await models.createAccount({
        username: username.trim(),
        passwordHash,
        role: role === 'admin' ? 'admin' : 'staff',
        employeeId: person.id,
        mustChangePassword: true,
      });
      credentials = { username: account.username, tempPassword, role: account.role };
    }

    const departments = await models.listDepartments();
    res.render('admin/onboard-employee', {
      title: 'Onboard New Employee',
      departments,
      error: null,
      result: { person, credentials },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Login accounts (who can sign in to the training MDC)
// ---------------------------------------------------------------------
router.post('/accounts', async (req, res, next) => {
  try {
    const { username, password, role, employeeId } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    await models.createAccount({
      username: username.trim(),
      passwordHash,
      role: role === 'admin' ? 'admin' : 'staff',
      employeeId: employeeId ? Number(employeeId) : null,
      // An admin picking the password here is functionally the same as a
      // temp password — the account holder still doesn't know it wasn't
      // chosen by them, so it still forces a change on first sign-in.
      mustChangePassword: true,
    });
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

router.delete('/accounts/:id', async (req, res, next) => {
  try {
    await models.deleteAccount(Number(req.params.id));
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
