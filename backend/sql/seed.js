// Seeds the training MDC with entirely fictional demo data.
//
// Safe to re-run — but NOT in the way that used to mean "wipes and rebuilds
// everything every time." It now refuses to touch a database that already
// has real data in it (training profiles, citations, whatever staff have
// built up), so re-running this — including every time SEED_ON_START=true
// runs it on container start, i.e. every redeploy — is a harmless no-op
// once you've actually started using the app. Pass FORCE_SEED=true when you
// genuinely want to wipe everything back to the fictional demo data (e.g.
// resetting a training environment between sessions).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/lib/db');
const migrate = require('../src/lib/migrate');
const { parseInfractionNarrative } = require('../src/lib/narrativeParser');

async function main() {
  console.log('Ensuring schema exists...');
  await migrate();

  if (process.env.FORCE_SEED !== 'true') {
    const existing = await pool.query('SELECT COUNT(*)::int AS count FROM "Employee"');
    if (existing.rows[0].count > 0) {
      console.log(
        `Database already has data (${existing.rows[0].count} profile(s)) — skipping seed so nothing gets ` +
          'overwritten. Set FORCE_SEED=true if you actually want to wipe everything and reload the demo data.'
      );
      return;
    }
  }

  console.log('Clearing existing data...');
  await pool.query(`
    TRUNCATE TABLE
      "WantedEntry", "ArrestWarrant", "InfractionCode", "Infraction", "Citation", "CautionCode",
      "License", "Business", "Garage", "Residence", "Phone", "Vehicle",
      "Account", "Employee", "Department", "PenalCode"
    RESTART IDENTITY CASCADE
  `);

  console.log('Creating penal code reference list...');
  // Straight from the San Andreas Penal Code (Title 4 — Traffic), just the
  // number/name/class the way staff would look them up — the actual code
  // text has tiered fines that don't reduce to one number, so those are
  // left at 0 ("—" in the UI) rather than guessing.
  const penalCodeSeed = [
    ['401', 'Driving Without a Valid License', 'Misdemeanor', 0],
    ['402', 'Driving On A Suspended License', 'Misdemeanor', 0],
    ['403', "Failure to Produce Driver's License", 'Infraction', 1000],
    ['404', 'Failure to Produce Vehicle Registration', 'Infraction', 1000],
    ['405', 'Failure to Produce Proof of Insurance', 'Infraction', 1000],
    ['406', 'Unregistered Vehicle', 'Infraction', 0],
    ['407', 'No Insurance', 'Infraction', 0],
    ['408', 'Hit and Run', 'Misdemeanor/Felony', 0],
    ['409', 'Reckless Operation Of an Off-Road or Naval Vehicle', 'Misdemeanor', 0],
    ['410', 'Speeding', 'Infraction', 0],
    ['411', 'Excessive Speeding', 'Infraction', 0],
    ['412', 'Failure to Yield/Stop to a Traffic Control Device', 'Infraction', 0],
    ['413', 'Failure to Yield at Intersection', 'Infraction', 0],
    ['414', 'Failure to Yield Entering Roadway', 'Infraction', 0],
    ['415', 'Failure to Yield for Crosswalk', 'Infraction', 0],
    ['416', 'Failure to Yield to an Emergency Vehicle', 'Infraction', 0],
    ['417', 'Improper Lane Entry while Turning', 'Infraction', 0],
    ['418', 'Prohibited Parking', 'Infraction', 0],
  ];
  const penalCodes = {};
  for (const [code, title, cls, fine] of penalCodeSeed) {
    const row = (
      await pool.query(
        'INSERT INTO "PenalCode" ("code","title","class","fineAmount") VALUES ($1,$2,$3,$4) RETURNING *',
        [code, title, cls, fine]
      )
    ).rows[0];
    penalCodes[code] = row;
  }

  console.log('Creating department...');
  const dept = (
    await pool.query('INSERT INTO "Department" ("name", "abbreviation") VALUES ($1, $2) RETURNING *', [
      'Los Santos Government',
      'LSG',
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
    ['Driving License', 'Los Santos', 'Valid', new Date('2030-01-01'), marcus.id]
  );
  await pool.query(
    'INSERT INTO "License" ("type","region","status","validUntil","personId") VALUES ($1,$2,$3,$4,$5)',
    ['Driving License', 'Los Santos', 'Valid', new Date('2029-06-15'), priya.id]
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
  await pool.query('INSERT INTO "Residence" ("address","personId") VALUES ($1,$2)', ['48 Fictional Ave, Los Santos', jordan.id]);
  await pool.query('INSERT INTO "Garage" ("name","address","personId") VALUES ($1,$2,$3)', [
    'Downtown Storage',
    '12 Warehouse Row, Los Santos',
    jordan.id,
  ]);
  await pool.query('INSERT INTO "Business" ("name","role","personId") VALUES ($1,$2,$3)', ['Kessler Auto Repair', 'Owner', jordan.id]);
  await pool.query(
    'INSERT INTO "License" ("type","region","status","validUntil","personId") VALUES ($1,$2,$3,$4,$5)',
    ['Driving License', 'Los Santos', 'Valid', new Date('2028-03-20'), jordan.id]
  );
  await pool.query('INSERT INTO "CautionCode" ("code","detail","personId") VALUES ($1,$2,$3)', [
    'CC-2',
    'Approach with an extra unit present',
    jordan.id,
  ]);
  await pool.query(
    `INSERT INTO "Vehicle"
       ("plate","vin","model","color","secondaryColor","vehicleClass","registered","insured","insuredSince","leased","ownerId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    ['TRN001', 'FICTVIN0000000001', 'Sabre GT', 'Red - Metallic', 'Black - Matte', 'Sports', true, true, new Date('2026-02-27T18:08:59'), false, jordan.id]
  );

  await pool.query('INSERT INTO "Phone" ("number","personId") VALUES ($1,$2)', ['14559982', elena.id]);
  await pool.query('INSERT INTO "Residence" ("address","personId") VALUES ($1,$2)', ['9 Fictional Blvd, Los Santos', elena.id]);
  await pool.query(
    `INSERT INTO "Vehicle"
       ("plate","vin","model","color","vehicleClass","registered","insured","leased","ownerId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['TRN002', 'FICTVIN0000000002', 'Comet Turbo', 'Black - Metallic', 'Sports', false, false, false, elena.id]
  );
  await pool.query('INSERT INTO "CautionCode" ("code","detail","personId") VALUES ($1,$2,$3)', [
    'CC-4',
    'Considered flight risk',
    elena.id,
  ]);

  await pool.query('INSERT INTO "Phone" ("number","personId") VALUES ($1,$2)', ['14559983', tyrell.id]);
  await pool.query('INSERT INTO "Business" ("name","role","personId") VALUES ($1,$2,$3)', ['Combs Freight Co.', 'Manager', tyrell.id]);
  await pool.query(
    `INSERT INTO "Vehicle"
       ("plate","vin","model","color","vehicleClass","registered","insured","insuredSince","leased","ownerId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    ['TRN003', 'FICTVIN0000000003', 'Mule 4x4', 'Grey - Matte', 'Off-Road', true, true, new Date('2025-11-04T10:00:00'), true, tyrell.id]
  );

  console.log('Creating infraction reports, citations, warrants, wanted entry...');

  // Built the same way a real staff member would — by pasting a report from
  // the "reports website" straight into the Narrative field. Running it
  // through the real parser here doubles as a smoke test for it.
  const speedingNarrativeRaw = `<strong>Priya Anand</strong> (<strong>#100002</strong>), on the <strong>22/Jan/2026</strong>, <strong>09:44</strong>.<br>Observed a <strong>Sabre GT</strong>, identification plate reading <strong>TRN001</strong>, registered to <strong>Jordan Kessler</strong>, traveling well above the posted limit on <strong>Innocence Boulevard</strong>, <strong>Los Santos</strong>.
<br>
<br>
<strong>Citation(s):</strong>
<ul>
<li><strong>IC 410</strong> — Speeding ($2500)</li>
</ul>
<strong>Citation Reason(s):</strong>
<ul>
<li>Clocked at 30 over the posted limit via radar.</li>
</ul>`;
  const speedingParsed = parseInfractionNarrative(speedingNarrativeRaw);

  const speedingReport = (
    await pool.query(
      `INSERT INTO "Infraction"
         ("personId","type","remark","status","timestamp","location","confidentialLevel","narrative","reportedBy")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        jordan.id,
        'Infraction Report',
        speedingParsed.codes.map((c) => c.codeLabel).join('; '),
        'Closed',
        new Date('2026-01-22T09:44:00'),
        'Innocence Boulevard, Downtown Los Santos',
        'Public',
        speedingParsed.displayNarrative,
        'Priya Anand',
      ]
    )
  ).rows[0];
  const speedingChildIds = [];
  for (const c of speedingParsed.codes) {
    const penalCodeId = c.rawCode && penalCodes[c.rawCode] ? penalCodes[c.rawCode].id : null;
    await pool.query(
      'INSERT INTO "InfractionCode" ("infractionId","penalCodeId","codeLabel","fineAmount","reasonText") VALUES ($1,$2,$3,$4,$5)',
      [speedingReport.id, penalCodeId, c.codeLabel, c.fineAmount, c.reasonText]
    );
  }

  await pool.query(
    `INSERT INTO "Citation"
       ("personId","issuedById","amount","reason","status","timestamp","vehiclePlate","streetName","infractionId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      jordan.id, priya.id, 2500, 'IC 410 — Speeding', 'Paid', new Date('2026-01-22T09:40:00'),
      'TRN001', 'Innocence Boulevard', speedingReport.id,
    ]
  );
  await pool.query(
    'INSERT INTO "Citation" ("personId","issuedById","amount","reason","status","timestamp","vehiclePlate") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [jordan.id, priya.id, 750, 'IC 112 — Illegal Parking', 'Unpaid', new Date('2026-06-02T14:05:00'), 'TRN001']
  );

  const speedingChild = (
    await pool.query(
      'INSERT INTO "Infraction" ("personId","type","remark","status","timestamp") VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [jordan.id, 'Infraction', 'IC 410. Speeding', 'Closed', new Date('2026-01-22T09:44:00')]
    )
  ).rows[0];
  speedingChildIds.push(speedingChild.id);

  // Same convention the app itself uses when a report is filed for real —
  // the report row's own remark just points at its line-item children
  // rather than repeating their code text.
  await pool.query('UPDATE "Infraction" SET "remark" = $1 WHERE "id" = $2', [
    speedingChildIds.map((cid) => `Infraction #${cid}`).join(', '),
    speedingReport.id,
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
