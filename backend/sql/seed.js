// Seeds the training MDC with entirely fictional demo data.
// Safe to re-run: it wipes and rebuilds all tables each time.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/lib/db');
const migrate = require('../src/lib/migrate');

async function main() {
  console.log('Ensuring schema exists...');
  await migrate();

  console.log('Clearing existing data...');
  await pool.query(`
    TRUNCATE TABLE
      "WantedEntry", "ArrestWarrant", "Infraction", "Citation", "CautionCode",
      "License", "Business", "Garage", "Residence", "Phone", "Vehicle",
      "Account", "Employee", "Department"
    RESTART IDENTITY CASCADE
  `);

  console.log('Creating department...');
  const dept = (
    await pool.query('INSERT INTO "Department" ("name", "abbreviation") VALUES ($1, $2) RETURNING *', [
      'City of Training Government',
      'CTG',
    ])
  ).rows[0];

  console.log('Creating training personnel...');
  const marcus = (
    await pool.query(
      `INSERT INTO "Employee" ("firstName","lastName","age","badgeNumber","rankTitle","isPersonnel","departmentId")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      ['Marcus', 'Webb', 34, 100001, 'Senior Records Analyst', true, dept.id]
    )
  ).rows[0];

  const priya = (
    await pool.query(
      `INSERT INTO "Employee" ("firstName","lastName","age","badgeNumber","rankTitle","isPersonnel","departmentId")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      ['Priya', 'Anand', 27, 100002, 'Parking Enforcement Officer', true, dept.id]
    )
  ).rows[0];

  await pool.query('INSERT INTO "Phone" ("number","label","personId") VALUES ($1,$2,$3)', ['14550100', 'Work', marcus.id]);
  await pool.query('INSERT INTO "Phone" ("number","label","personId") VALUES ($1,$2,$3)', ['14550101', 'Work', priya.id]);
  await pool.query(
    'INSERT INTO "License" ("type","region","status","validUntil","personId") VALUES ($1,$2,$3,$4,$5)',
    ['Driving License', 'Training City', 'Valid', new Date('2030-01-01'), marcus.id]
  );
  await pool.query(
    'INSERT INTO "License" ("type","region","status","validUntil","personId") VALUES ($1,$2,$3,$4,$5)',
    ['Driving License', 'Training City', 'Valid', new Date('2029-06-15'), priya.id]
  );

  console.log('Creating civilian training profiles...');
  const jordan = (
    await pool.query(
      `INSERT INTO "Employee" ("firstName","lastName","age","isPersonnel") VALUES ($1,$2,$3,$4) RETURNING *`,
      ['Jordan', 'Kessler', 29, false]
    )
  ).rows[0];
  const elena = (
    await pool.query(
      `INSERT INTO "Employee" ("firstName","lastName","age","isPersonnel") VALUES ($1,$2,$3,$4) RETURNING *`,
      ['Elena', 'Vasquez', 31, false]
    )
  ).rows[0];
  const tyrell = (
    await pool.query(
      `INSERT INTO "Employee" ("firstName","lastName","age","isPersonnel") VALUES ($1,$2,$3,$4) RETURNING *`,
      ['Tyrell', 'Combs', 40, false]
    )
  ).rows[0];

  await pool.query('INSERT INTO "Phone" ("number","personId") VALUES ($1,$2)', ['14559981', jordan.id]);
  await pool.query('INSERT INTO "Residence" ("address","personId") VALUES ($1,$2)', ['48 Fictional Ave, Training City', jordan.id]);
  await pool.query('INSERT INTO "Garage" ("name","address","personId") VALUES ($1,$2,$3)', [
    'Downtown Storage',
    '12 Warehouse Row, Training City',
    jordan.id,
  ]);
  await pool.query('INSERT INTO "Business" ("name","role","personId") VALUES ($1,$2,$3)', ['Kessler Auto Repair', 'Owner', jordan.id]);
  await pool.query(
    'INSERT INTO "License" ("type","region","status","validUntil","personId") VALUES ($1,$2,$3,$4,$5)',
    ['Driving License', 'Training City', 'Valid', new Date('2028-03-20'), jordan.id]
  );
  await pool.query('INSERT INTO "CautionCode" ("code","detail","personId") VALUES ($1,$2,$3)', [
    'CC-2',
    'Approach with an extra unit present',
    jordan.id,
  ]);
  await pool.query(
    'INSERT INTO "Vehicle" ("plate","vin","model","color","registered","insured","ownerId") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    ['TRN001', 'FICTVIN0000000001', 'Sabre GT', 'Red', true, true, jordan.id]
  );

  await pool.query('INSERT INTO "Phone" ("number","personId") VALUES ($1,$2)', ['14559982', elena.id]);
  await pool.query('INSERT INTO "Residence" ("address","personId") VALUES ($1,$2)', ['9 Fictional Blvd, Training City', elena.id]);
  await pool.query(
    'INSERT INTO "Vehicle" ("plate","vin","model","color","registered","insured","ownerId") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    ['TRN002', 'FICTVIN0000000002', 'Comet Turbo', 'Black', false, false, elena.id]
  );
  await pool.query('INSERT INTO "CautionCode" ("code","detail","personId") VALUES ($1,$2,$3)', [
    'CC-4',
    'Considered flight risk',
    elena.id,
  ]);

  await pool.query('INSERT INTO "Phone" ("number","personId") VALUES ($1,$2)', ['14559983', tyrell.id]);
  await pool.query('INSERT INTO "Business" ("name","role","personId") VALUES ($1,$2,$3)', ['Combs Freight Co.', 'Manager', tyrell.id]);
  await pool.query(
    'INSERT INTO "Vehicle" ("plate","vin","model","color","registered","insured","ownerId") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    ['TRN003', 'FICTVIN0000000003', 'Mule 4x4', 'Grey', true, true, tyrell.id]
  );

  console.log('Creating citations, infractions, warrants, wanted entry...');
  await pool.query(
    'INSERT INTO "Citation" ("personId","issuedById","amount","reason","status","timestamp") VALUES ($1,$2,$3,$4,$5,$6)',
    [jordan.id, priya.id, 2500, '410. Speeding (I)', 'Paid', new Date('2026-01-22T09:40:00')]
  );
  await pool.query(
    'INSERT INTO "Citation" ("personId","issuedById","amount","reason","status","timestamp") VALUES ($1,$2,$3,$4,$5,$6)',
    [jordan.id, priya.id, 750, '112. Illegal Parking', 'Unpaid', new Date('2026-06-02T14:05:00')]
  );

  await pool.query('INSERT INTO "Infraction" ("personId","type","remark","status","timestamp") VALUES ($1,$2,$3,$4,$5)', [
    jordan.id,
    'Infraction',
    'IC 410. Speeding',
    'Closed',
    new Date('2026-01-22T09:44:00'),
  ]);
  await pool.query('INSERT INTO "Infraction" ("personId","type","remark","status","timestamp") VALUES ($1,$2,$3,$4,$5)', [
    jordan.id,
    'Infraction Report',
    'Infraction Report for prior speeding citation',
    'Closed',
    new Date('2026-01-22T09:44:00'),
  ]);

  await pool.query(
    'INSERT INTO "ArrestWarrant" ("personId","classification","charges","filedBy","signedBy","status") VALUES ($1,$2,$3,$4,$5,$6)',
    [tyrell.id, 'Felony', '2x 401. Grand Theft Auto, 1x 508. Evading Police', 'Marcus Webb', 'Hon. J. Ortiz', 'Active']
  );

  await pool.query(
    'INSERT INTO "WantedEntry" ("personId","reason","dangerLevel","postedBy","active") VALUES ($1,$2,$3,$4,$5)',
    [elena.id, 'Failure to appear on outstanding grand theft charges', 'High', 'Marcus Webb', true]
  );

  console.log('Creating login accounts...');
  const adminPass = await bcrypt.hash('admin123', 10);
  const staffPass = await bcrypt.hash('training123', 10);

  await pool.query('INSERT INTO "Account" ("username","passwordHash","role","employeeId") VALUES ($1,$2,$3,$4)', [
    'admin',
    adminPass,
    'admin',
    marcus.id,
  ]);
  await pool.query('INSERT INTO "Account" ("username","passwordHash","role","employeeId") VALUES ($1,$2,$3,$4)', [
    'panand',
    staffPass,
    'staff',
    priya.id,
  ]);

  console.log('Seed complete.');
  console.log('Login with admin / admin123  (or)  panand / training123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
