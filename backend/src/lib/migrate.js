// Applies sql/schema.sql. Plain SQL, no migration framework/binary needed —
// every statement in the file is idempotent (CREATE TABLE IF NOT EXISTS),
// so this is safe to run on every container start.
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Schema applied.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
