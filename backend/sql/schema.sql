-- MDC Training Replica schema (plain SQL, no ORM required).
-- Safe to run repeatedly: every statement is idempotent.

CREATE TABLE IF NOT EXISTS "Department" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT UNIQUE NOT NULL,
  "abbreviation" TEXT
);

CREATE TABLE IF NOT EXISTS "Employee" (
  "id" SERIAL PRIMARY KEY,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "age" INTEGER,
  "imageUrl" TEXT,
  "badgeNumber" INTEGER UNIQUE,
  "rankTitle" TEXT,
  "isPersonnel" BOOLEAN NOT NULL DEFAULT false,
  "departmentId" INTEGER REFERENCES "Department"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Account" (
  "id" SERIAL PRIMARY KEY,
  "username" TEXT UNIQUE NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'staff',
  "employeeId" INTEGER UNIQUE REFERENCES "Employee"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Vehicle" (
  "id" SERIAL PRIMARY KEY,
  "plate" TEXT UNIQUE NOT NULL,
  "vin" TEXT UNIQUE NOT NULL,
  "model" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "registered" BOOLEAN NOT NULL DEFAULT true,
  "insured" BOOLEAN NOT NULL DEFAULT true,
  "ownerId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added for the vehicle detail page. ADD COLUMN IF NOT EXISTS keeps this
-- safe to re-run against a database created by an earlier version of this
-- schema (e.g. a stack that's already been deployed once).
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "vehicleClass" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "secondaryColor" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "insuredSince" TIMESTAMPTZ;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "leased" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "Citation" (
  "id" SERIAL PRIMARY KEY,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Unpaid',
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "issuedById" INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "Infraction" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "remark" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Open',
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

-- Added for the "Create Infraction Report" workflow.
ALTER TABLE "Infraction" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "Infraction" ADD COLUMN IF NOT EXISTS "confidentialLevel" TEXT NOT NULL DEFAULT 'Public';
ALTER TABLE "Infraction" ADD COLUMN IF NOT EXISTS "narrative" TEXT;
ALTER TABLE "Infraction" ADD COLUMN IF NOT EXISTS "reportedBy" TEXT;
ALTER TABLE "Infraction" ADD COLUMN IF NOT EXISTS "evidenceUrls" TEXT;

-- Reference list of fictional penal codes staff can attach to an infraction
-- report. Stands in for "pasting a code from the reports website" — staff
-- type/paste a code (e.g. "410") and it resolves against this table.
CREATE TABLE IF NOT EXISTS "PenalCode" (
  "id" SERIAL PRIMARY KEY,
  "code" TEXT UNIQUE NOT NULL,
  "title" TEXT NOT NULL,
  "class" TEXT NOT NULL DEFAULT 'Infraction',
  "fineAmount" INTEGER NOT NULL DEFAULT 0
);

-- One infraction report can have multiple penal codes attached. The label
-- and fine are snapshotted at the time the report was filed so a later edit
-- to the PenalCode reference table doesn't rewrite history.
CREATE TABLE IF NOT EXISTS "InfractionCode" (
  "id" SERIAL PRIMARY KEY,
  "infractionId" INTEGER NOT NULL REFERENCES "Infraction"("id") ON DELETE CASCADE,
  "penalCodeId" INTEGER REFERENCES "PenalCode"("id") ON DELETE SET NULL,
  "codeLabel" TEXT NOT NULL,
  "fineAmount" INTEGER NOT NULL DEFAULT 0
);

-- Added for the citation-issuing workflow. A citation can optionally be tied
-- back to the infraction report it came from, and carries a free-text plate
-- / street snapshot rather than a hard vehicle FK, since the officer may
-- cite a plate that isn't in the system yet. Placed after "Infraction"
-- exists so the FK reference resolves.
ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "vehiclePlate" TEXT;
ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "streetName" TEXT;
ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "infractionId" INTEGER REFERENCES "Infraction"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "ArrestWarrant" (
  "id" SERIAL PRIMARY KEY,
  "classification" TEXT NOT NULL,
  "charges" TEXT NOT NULL,
  "filedBy" TEXT NOT NULL,
  "signedBy" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Active',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "WantedEntry" (
  "id" SERIAL PRIMARY KEY,
  "reason" TEXT NOT NULL,
  "dangerLevel" TEXT NOT NULL DEFAULT 'Low',
  "postedBy" TEXT NOT NULL,
  "postedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "personId" INTEGER UNIQUE NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "License" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL DEFAULT 'Driving License',
  "region" TEXT NOT NULL DEFAULT 'Los Santos',
  "status" TEXT NOT NULL DEFAULT 'Valid',
  "validUntil" TIMESTAMPTZ,
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Phone" (
  "id" SERIAL PRIMARY KEY,
  "number" TEXT NOT NULL,
  "label" TEXT,
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Residence" (
  "id" SERIAL PRIMARY KEY,
  "address" TEXT NOT NULL,
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Garage" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Business" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "CautionCode" (
  "id" SERIAL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "detail" TEXT,
  "personId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE
);
