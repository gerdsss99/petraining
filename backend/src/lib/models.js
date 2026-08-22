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
  return vehicle;
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
  getActiveWantedEntries,
  upsertWanted,
  clearWanted,
  listDepartments,
  upsertDepartmentByName,
  findAccountByUsername,
  findAccountById,
  listAccounts,
  createAccount,
  deleteAccount,
};
