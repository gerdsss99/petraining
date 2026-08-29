const pool = require('./db');

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}
async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}
async function count(text, params) {
  const { rows } = await pool.query(text, params);
  return Number(rows[0].count);
}

// Generic insert used by the admin "child record" forms (vehicles, phones,
// citations, ...). `table` and the keys of `data` always come from a fixed
// server-side config (see routes/admin.js), never directly from user input,
// so building the column list this way is safe.
async function insertRow(table, data) {
  const columns = Object.keys(data);
  const values = Object.values(data);
  const collist = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const text = `INSERT INTO "${table}" (${collist}) VALUES (${placeholders}) RETURNING *`;
  return one(text, values);
}

async function deleteRow(table, id) {
  await pool.query(`DELETE FROM "${table}" WHERE "id" = $1`, [id]);
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
async function getDashboardStats() {
  const [personnel, vehicles, citations, infractions, warrants, apbs] = await Promise.all([
    count('SELECT COUNT(*) FROM "Employee" WHERE "isPersonnel" = true'),
    count('SELECT COUNT(*) FROM "Vehicle"'),
    count('SELECT COUNT(*) FROM "Citation"'),
    count('SELECT COUNT(*) FROM "Infraction"'),
    count('SELECT COUNT(*) FROM "ArrestWarrant"'),
    count('SELECT COUNT(*) FROM "WantedEntry" WHERE "active" = true'),
  ]);
  return { personnel, vehicles, records: citations + infractions + warrants, apbs };
}

// ---------------------------------------------------------------------
// Employees / Person Database
// ---------------------------------------------------------------------
// Exact-match lookup used by the Person Lookup search box — mirrors how the
// reference MDC jumps straight to a record rather than showing a results
// list. Tries a full "First Last" match first, then falls back to a
// last-name match if it uniquely identifies one person.
// Returns { status: 'found', id } | { status: 'ambiguous' } | { status: 'not_found' }.
async function findEmployeeByQuery(q) {
  const query = (q || '').trim();
  if (!query) return { status: 'empty' };

  const exact = await one(
    `SELECT "id" FROM "Employee" WHERE LOWER("firstName" || ' ' || "lastName") = LOWER($1)`,
    [query]
  );
  if (exact) return { status: 'found', id: exact.id };

  const byLastName = await many(`SELECT "id" FROM "Employee" WHERE LOWER("lastName") = LOWER($1)`, [query]);
  if (byLastName.length === 1) return { status: 'found', id: byLastName[0].id };
  if (byLastName.length > 1) return { status: 'ambiguous' };

  return { status: 'not_found' };
}

async function listEmployeesForAdmin() {
  return many(
    `SELECT e.*, d."name" AS "departmentName"
     FROM "Employee" e LEFT JOIN "Department" d ON d."id" = e."departmentId"
     ORDER BY e."id" DESC`
  );
}

async function getEmployeeFull(id) {
  const employee = await one(
    `SELECT e.*, d."name" AS "departmentName"
     FROM "Employee" e LEFT JOIN "Department" d ON d."id" = e."departmentId"
     WHERE e."id" = $1`,
    [id]
  );
  if (!employee) return null;

  const [
    phones,
    vehicles,
    residences,
    garages,
    businesses,
    licenses,
    cautionCodes,
    citations,
    infractions,
    arrestWarrants,
    wantedEntry,
  ] = await Promise.all([
    many('SELECT * FROM "Phone" WHERE "personId" = $1 ORDER BY "id"', [id]),
    many('SELECT * FROM "Vehicle" WHERE "ownerId" = $1 ORDER BY "id"', [id]),
    many('SELECT * FROM "Residence" WHERE "personId" = $1 ORDER BY "id"', [id]),
    many('SELECT * FROM "Garage" WHERE "personId" = $1 ORDER BY "id"', [id]),
    many('SELECT * FROM "Business" WHERE "personId" = $1 ORDER BY "id"', [id]),
    many('SELECT * FROM "License" WHERE "personId" = $1 ORDER BY "id"', [id]),
    many('SELECT * FROM "CautionCode" WHERE "personId" = $1 ORDER BY "id"', [id]),
    many(
      `SELECT c.*, e."firstName" AS "issuedByFirstName", e."lastName" AS "issuedByLastName"
       FROM "Citation" c LEFT JOIN "Employee" e ON e."id" = c."issuedById"
       WHERE c."personId" = $1 ORDER BY c."timestamp" DESC`,
      [id]
    ),
    many('SELECT * FROM "Infraction" WHERE "personId" = $1 ORDER BY "timestamp" DESC', [id]),
    many('SELECT * FROM "ArrestWarrant" WHERE "personId" = $1 ORDER BY "createdAt" DESC', [id]),
    one('SELECT * FROM "WantedEntry" WHERE "personId" = $1', [id]),
  ]);

  return { ...employee, phones, vehicles, residences, garages, businesses, licenses, cautionCodes, citations, infractions, arrestWarrants, wantedEntry };
}

async function createEmployee(data) {
  return insertRow('Employee', data);
}

async function updateEmployee(id, data) {
  const columns = Object.keys(data);
  const values = Object.values(data);
  const setClause = columns.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const text = `UPDATE "Employee" SET ${setClause}, "updatedAt" = now() WHERE "id" = $${columns.length + 1} RETURNING *`;
  return one(text, [...values, id]);
}

async function deleteEmployee(id) {
  // Child tables all reference Employee with ON DELETE CASCADE, so this
  // single statement is enough. Accounts linked to this employee just have
  // their employeeId cleared (ON DELETE SET NULL) rather than being deleted.
  await pool.query('DELETE FROM "Employee" WHERE "id" = $1', [id]);
}

// ---------------------------------------------------------------------
// Vehicles / DMV
// ---------------------------------------------------------------------
// Exact-match plate lookup used by the DMV Database search box — plates are
// unique, so unlike names this always resolves to at most one vehicle.
// Ignores spaces/case so "SRY 298" and "sry298" both find "SRY298".
async function findVehicleByPlate(q) {
  const query = (q || '').trim();
  if (!query) return null;
  return one(`SELECT "id" FROM "Vehicle" WHERE UPPER(REPLACE("plate", ' ', '')) = UPPER(REPLACE($1, ' ', ''))`, [query]);
}

async function getVehicleFull(id) {
  const vehicle = await one(
    `SELECT v.*, e."firstName" AS "ownerFirstName", e."lastName" AS "ownerLastName"
     FROM "Vehicle" v JOIN "Employee" e ON e."id" = v."ownerId"
     WHERE v."id" = $1`,
    [id]
  );
  if (!vehicle) return null;

  // Citations carry a free-text vehiclePlate snapshot rather than a hard FK
  // (an officer can cite a plate that isn't in the system), so this is
  // matched the same way plate search is — ignoring spaces/case.
  const citations = await many(
    `SELECT c.*, e."firstName" AS "issuedByFirstName", e."lastName" AS "issuedByLastName"
     FROM "Citation" c LEFT JOIN "Employee" e ON e."id" = c."issuedById"
     WHERE UPPER(REPLACE(c."vehiclePlate", ' ', '')) = UPPER(REPLACE($1, ' ', ''))
     ORDER BY c."timestamp" DESC`,
    [vehicle.plate]
  );

  const infractionIds = [...new Set(citations.map((c) => c.infractionId).filter(Boolean))];
  const relatedIncidents = infractionIds.length
    ? await many(
        `SELECT * FROM "Infraction" WHERE "id" = ANY($1::int[]) ORDER BY "timestamp" DESC`,
        [infractionIds]
      )
    : [];

  vehicle.citations = citations;
  vehicle.relatedIncidents = relatedIncidents;
  return vehicle;
}

// ---------------------------------------------------------------------
// Penal codes / infraction reports / citations
// ---------------------------------------------------------------------
async function listPenalCodes() {
  return many('SELECT * FROM "PenalCode" ORDER BY "code"');
}

// Best-effort lookup for the "paste a code" field on the infraction report
// form. Staff may type just the number ("410") or paste something longer
// like "410 - Speeding (I)" — we try an exact match on the whole string
// first, then fall back to matching the leading token.
async function findPenalCodeByCode(raw) {
  // Staff may paste/type "410", "IC 410", or "410 - Speeding (I)" — strip a
  // leading "IC" and try the whole string, then fall back to the leading
  // token.
  const value = (raw || '').trim().replace(/^ic\s*/i, '');
  if (!value) return null;
  const exact = await one('SELECT * FROM "PenalCode" WHERE LOWER("code") = LOWER($1)', [value]);
  if (exact) return exact;
  const leadingToken = value.split(/[\s,;-]+/)[0];
  if (leadingToken && leadingToken !== value) {
    return one('SELECT * FROM "PenalCode" WHERE LOWER("code") = LOWER($1)', [leadingToken]);
  }
  return null;
}

// How many times this exact penal code has already been filed against this
// person, across every past Infraction Report — the count that drives the
// "(Second Offense)" / "(Third Offense)" / ... suffix. Codes that never
// resolved to a PenalCode row (a typo, a code not in the reference table)
// can't be counted this way, so callers should treat penalCodeId-less codes
// as always a first offense.
async function countPriorOffenses(personId, penalCodeId) {
  if (!penalCodeId) return 0;
  const row = await one(
    `SELECT COUNT(*)::int AS count
     FROM "InfractionCode" ic
     JOIN "Infraction" i ON i."id" = ic."infractionId"
     WHERE i."personId" = $1 AND ic."penalCodeId" = $2`,
    [personId, penalCodeId]
  );
  return row ? row.count : 0;
}

// Spelled-out ordinal words for the offense-count suffix, index === the
// offense number (index 0/1 unused — a first offense gets no suffix at
// all). Every count keeps counting up on its own ordinal rather than
// collapsing everything from the third offense on into one "Third or More"
// bucket, so a person's fourth, fifth, sixth (...) offense reads as exactly
// that.
const ORDINAL_WORDS = [
  null, null, 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth',
  'Eighteenth', 'Nineteenth', 'Twentieth',
];

// Numeral fallback ("21st Offense", "32nd Offense", ...) for anything past
// the spelled-out list above — an edge case in practice, but this keeps an
// implausibly long history on one code correct instead of undefined.
function numericOrdinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function ordinalOffenseWord(n) {
  return ORDINAL_WORDS[n] || numericOrdinal(n);
}

// Builds the final "IC 418 — Prohibited Parking (Second Offense)" label for
// one code being attached to a new report, from a clean title (the reports
// site's own offense wording is stripped out before this ever runs — see
// narrativeParser.stripOffenseSuffix) plus this person's real prior count
// for that code. A first offense gets no qualifier at all, matching how the
// reference codes read when there's nothing to flag.
async function buildInfractionCodeLabel(personId, c) {
  if (!c.rawCode) return c.title; // no structured code — nothing to count or label with "IC ###"
  const base = `IC ${c.rawCode} — ${c.title}`;
  const priorCount = await countPriorOffenses(personId, c.penalCodeId);
  const ordinal = priorCount + 1;
  if (ordinal <= 1) return base;
  return `${base} (${ordinalOffenseWord(ordinal)} Offense)`;
}

// Creates an Infraction row plus its attached InfractionCode rows in one
// go. `codes` is an array of { penalCodeId, codeLabel, fineAmount }. A real
// officer files a report live, so `data.timestamp` is normally left unset
// and defaults to now() — it exists so a backfilled/historical report (see
// the "New Civilian Profile" quick intake in routes/admin.js) can be dated
// in the past instead of showing as filed today.
async function createInfractionReport(data) {
  const infraction = await one(
    `INSERT INTO "Infraction"
       ("personId","type","remark","status","location","confidentialLevel","narrative","reportedBy","evidenceUrls","timestamp")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now())) RETURNING *`,
    [
      data.personId,
      'Infraction Report',
      data.remark,
      data.status,
      data.location || null,
      data.confidentialLevel,
      data.narrative || null,
      data.reportedBy || null,
      data.evidenceUrls || null,
      data.timestamp || null,
    ]
  );

  const childIds = [];
  for (const c of data.codes) {
    await pool.query(
      `INSERT INTO "InfractionCode" ("infractionId","penalCodeId","codeLabel","fineAmount","reasonText") VALUES ($1,$2,$3,$4,$5)`,
      [infraction.id, c.penalCodeId || null, c.codeLabel, c.fineAmount || 0, c.reasonText || null]
    );

    // Alongside the InfractionCode line (used to render the report itself),
    // log a matching entry in the person's own Infraction Record for this
    // specific code — e.g. "IC 418. Prohibited Parking" — the same way the
    // Registered Vehicles / DMV workflow lists each violation individually.
    // Without this, a multi-code report only ever showed up as the single
    // "Infraction Report" row and its codes never appeared as their own
    // Infraction Record entries.
    const child = await one(
      `INSERT INTO "Infraction" ("personId","type","remark","status","timestamp") VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.personId, 'Infraction', c.codeLabel.replace(/\s*—\s*/, '. '), data.status, infraction.timestamp]
    );
    childIds.push(child.id);
  }

  // The report row's own remark doesn't repeat the code text (that's what
  // the child rows above are for) — it just points at them, "Infraction #7,
  // Infraction #8", the same way the report references its own line items
  // everywhere else in the app.
  if (childIds.length) {
    infraction.remark = childIds.map((cid) => `Infraction #${cid}`).join(', ');
    await pool.query('UPDATE "Infraction" SET "remark" = $1 WHERE "id" = $2', [infraction.remark, infraction.id]);
  }

  return infraction;
}

async function getInfractionFull(id) {
  const infraction = await one(
    `SELECT i.*, e."firstName" AS "personFirstName", e."lastName" AS "personLastName"
     FROM "Infraction" i JOIN "Employee" e ON e."id" = i."personId"
     WHERE i."id" = $1`,
    [id]
  );
  if (!infraction) return null;

  const [codes, citations] = await Promise.all([
    many('SELECT * FROM "InfractionCode" WHERE "infractionId" = $1 ORDER BY "id"', [id]),
    many(
      `SELECT c.*, e."firstName" AS "issuedByFirstName", e."lastName" AS "issuedByLastName"
       FROM "Citation" c LEFT JOIN "Employee" e ON e."id" = c."issuedById"
       WHERE c."infractionId" = $1 ORDER BY c."timestamp" DESC`,
      [id]
    ),
  ]);

  infraction.codes = codes;
  infraction.citations = citations;
  infraction.evidenceList = (infraction.evidenceUrls || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return infraction;
}

async function createCitation(data) {
  return one(
    `INSERT INTO "Citation" ("personId","issuedById","amount","reason","status","vehiclePlate","streetName","infractionId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      data.personId,
      data.issuedById || null,
      data.amount,
      data.reason,
      data.status || 'Unpaid',
      data.vehiclePlate || null,
      data.streetName || null,
      data.infractionId || null,
    ]
  );
}

// ---------------------------------------------------------------------
// Wanted database
// ---------------------------------------------------------------------
async function getActiveWantedEntries() {
  return many(
    `SELECT w.*, e."firstName" AS "personFirstName", e."lastName" AS "personLastName"
     FROM "WantedEntry" w JOIN "Employee" e ON e."id" = w."personId"
     WHERE w."active" = true ORDER BY w."postedAt" DESC`
  );
}

async function upsertWanted(personId, data) {
  return one(
    `INSERT INTO "WantedEntry" ("personId", "reason", "dangerLevel", "postedBy", "active", "postedAt")
     VALUES ($1, $2, $3, $4, true, now())
     ON CONFLICT ("personId") DO UPDATE SET
       "reason" = EXCLUDED."reason", "dangerLevel" = EXCLUDED."dangerLevel",
       "postedBy" = EXCLUDED."postedBy", "active" = true, "postedAt" = now()
     RETURNING *`,
    [personId, data.reason, data.dangerLevel, data.postedBy]
  );
}

async function clearWanted(personId) {
  await pool.query('DELETE FROM "WantedEntry" WHERE "personId" = $1', [personId]);
}

// ---------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------
async function listDepartments() {
  return many('SELECT * FROM "Department" ORDER BY "name"');
}

async function upsertDepartmentByName(name) {
  return one(
    `INSERT INTO "Department" ("name") VALUES ($1)
     ON CONFLICT ("name") DO UPDATE SET "name" = EXCLUDED."name"
     RETURNING *`,
    [name]
  );
}

// ---------------------------------------------------------------------
// Accounts (login)
// ---------------------------------------------------------------------
async function findAccountByUsername(username) {
  return one('SELECT * FROM "Account" WHERE "username" = $1', [username]);
}

// Login also accepts an Employee's badge number in place of a username (the
// same password either way) — a lot of real MDC-style tools let officers do
// this, and it's a small convenience for people who remember their badge
// number more readily than whatever username they were issued. "badgeNumber"
// is an INTEGER column, so a non-numeric login attempt (a normal username)
// must never reach it as a comparison value or Postgres throws a type error;
// $2 is only ever a parsed integer or NULL, guarded below.
async function findAccountByUsernameOrBadge(identifier) {
  const badge = /^\d+$/.test(String(identifier || '').trim())
    ? parseInt(identifier, 10)
    : null;
  return one(
    `SELECT a.* FROM "Account" a
     LEFT JOIN "Employee" e ON e."id" = a."employeeId"
     WHERE a."username" = $1 OR ($2::INTEGER IS NOT NULL AND e."badgeNumber" = $2)
     ORDER BY (a."username" = $1) DESC
     LIMIT 1`,
    [identifier, badge]
  );
}

async function findAccountById(id) {
  const account = await one('SELECT * FROM "Account" WHERE "id" = $1', [id]);
  if (!account) return null;
  if (account.employeeId) {
    account.employee = await one(
      `SELECT e.*, d."name" AS "departmentName"
       FROM "Employee" e LEFT JOIN "Department" d ON d."id" = e."departmentId"
       WHERE e."id" = $1`,
      [account.employeeId]
    );
  } else {
    account.employee = null;
  }
  return account;
}

async function listAccounts() {
  const accounts = await many(
    `SELECT a.*, e."firstName" AS "employeeFirstName", e."lastName" AS "employeeLastName"
     FROM "Account" a LEFT JOIN "Employee" e ON e."id" = a."employeeId"
     ORDER BY a."id"`
  );
  return accounts;
}

async function createAccount(data) {
  return insertRow('Account', data);
}

async function deleteAccount(id) {
  await pool.query('DELETE FROM "Account" WHERE "id" = $1', [id]);
}

// Used both by the forced first-login change screen and a voluntary
// "change my password" — clears mustChangePassword either way, since a
// voluntary change satisfies the same requirement a forced one would.
async function setAccountPassword(id, passwordHash) {
  await pool.query(
    'UPDATE "Account" SET "passwordHash" = $1, "mustChangePassword" = false WHERE "id" = $2',
    [passwordHash, id]
  );
}

module.exports = {
  insertRow,
  deleteRow,
  getDashboardStats,
  findEmployeeByQuery,
  listEmployeesForAdmin,
  getEmployeeFull,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  findVehicleByPlate,
  getVehicleFull,
  listPenalCodes,
  findPenalCodeByCode,
  countPriorOffenses,
  buildInfractionCodeLabel,
  createInfractionReport,
  getInfractionFull,
  createCitation,
  getActiveWantedEntries,
  upsertWanted,
  clearWanted,
  listDepartments,
  upsertDepartmentByName,
  findAccountByUsername,
  findAccountByUsernameOrBadge,
  findAccountById,
  listAccounts,
  createAccount,
  deleteAccount,
  setAccountPassword,
};
