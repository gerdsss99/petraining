const express = require('express');
const bcrypt = require('bcryptjs');
const models = require('../lib/models');
const { requireAdmin } = require('../middleware/auth');

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
    const [people, accounts, departments] = await Promise.all([
      models.listEmployeesForAdmin(),
      models.listAccounts(),
      models.listDepartments(),
    ]);
    res.render('admin/index', { title: 'Admin', people, accounts, departments });
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
    res.render('admin/person-form', { title: 'New Profile', person: null, departments });
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

    res.render('admin/person-form', { title: `Edit ${person.firstName} ${person.lastName}`, person, departments });
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
    res.redirect(`/admin/people/${req.params.personId}/edit`);
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
