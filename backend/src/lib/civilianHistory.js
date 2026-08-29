const crypto = require('crypto');

// Small, purely fictional building blocks the "New Civilian Profile" quick
// intake form uses to generate a plausible-looking vehicle + citation
// history in one click, instead of an FTO typing every field out by hand.
// None of this is meant to be precise — it just needs to look like a real
// training record.

// Fine amounts here are made up for training purposes rather than pulled
// from the seeded PenalCode reference table, since most of those entries
// carry a $0 placeholder fine (see sql/seed.js) and wouldn't read as real
// citations on a profile.
const CITATION_TEMPLATES = [
  { reason: 'Speeding', amount: 150 },
  { reason: 'Illegal Parking', amount: 50 },
  { reason: 'Expired Registration', amount: 75 },
  { reason: 'Running a Red Light', amount: 180 },
  { reason: 'No Proof of Insurance', amount: 250 },
  { reason: 'Failure to Yield', amount: 120 },
  { reason: 'Reckless Driving', amount: 300 },
  { reason: 'Illegal U-Turn', amount: 90 },
  { reason: 'Unsafe Lane Change', amount: 100 },
  { reason: 'Blocking a Crosswalk', amount: 60 },
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// A random moment somewhere in the last `maxDaysAgo` days (at least an hour
// ago), so a "previous citation" actually reads as being in the past rather
// than defaulting to right now — and so 2-3 generated at once naturally land
// on different days instead of all sharing one timestamp.
function randomPastDateTime(maxDaysAgo) {
  const maxMs = maxDaysAgo * 24 * 60 * 60 * 1000;
  const msAgo = Math.floor(Math.random() * maxMs) + 60 * 60 * 1000;
  return new Date(Date.now() - msAgo);
}

// "Previous citations" span a wider window (up to ~8 months back) than a
// "just expired" insurance policy (up to ~45 days back, per how an FTO would
// actually describe a policy that recently lapsed).
function randomPastCitationDate() {
  return randomPastDateTime(240);
}
function randomRecentExpirationDate() {
  return randomPastDateTime(45);
}

// One generated { reason, amount, status, timestamp } per requested prior
// citation. status is randomly Paid or Unpaid — the FTO doesn't pick this
// per-citation, just how many to add; the matching Infraction Record for
// each one takes its Open/Closed status from this same coin flip, so the
// two stay in sync (see routes/admin.js).
function generateCitationHistory(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const template = randomItem(CITATION_TEMPLATES);
    out.push({
      reason: template.reason,
      amount: template.amount,
      status: Math.random() < 0.5 ? 'Paid' : 'Unpaid',
      timestamp: randomPastCitationDate(),
    });
  }
  return out;
}

// Alphabet mirrors lib/passwords.js — no 0/O/1/I/l lookalikes, in case
// anyone ever needs to read this off a screen or type it somewhere.
const VIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// A real VIN is 17 characters; this is a made-up stand-in filled in
// automatically since a quick civilian intake form has no reason to ask an
// FTO for one.
function generateFakeVin() {
  let out = '';
  const bytes = crypto.randomBytes(17);
  for (let i = 0; i < 17; i++) out += VIN_ALPHABET[bytes[i] % VIN_ALPHABET.length];
  return out;
}

const VEHICLE_COLORS = ['Black', 'White', 'Silver', 'Gray', 'Blue', 'Red', 'Green', 'Tan'];
function randomVehicleColor() {
  return randomItem(VEHICLE_COLORS);
}

module.exports = {
  generateCitationHistory,
  randomRecentExpirationDate,
  generateFakeVin,
  randomVehicleColor,
};
