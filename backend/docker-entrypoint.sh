#!/bin/sh
set -e

echo "Waiting for database..."
until node -e "
  const { Pool } = require('pg');
  new Pool({ connectionString: process.env.DATABASE_URL })
    .query('SELECT 1')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
"; do
  echo "  database not ready yet, retrying in 2s..."
  sleep 2
done

echo "Applying schema..."
node src/lib/migrate.js

if [ "$SEED_ON_START" = "true" ]; then
  # seed.js itself now refuses to touch a database that already has real
  # data in it (see the comment at the top of that file) unless
  # FORCE_SEED=true is set — so this runs on every start/redeploy, but only
  # actually seeds anything the first time, against an empty database.
  echo "Checking demo data (SEED_ON_START=true)..."
  node sql/seed.js
fi

echo "Starting app..."
exec "$@"
