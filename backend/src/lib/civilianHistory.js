const crypto = require('crypto');

// Small, purely fictional building blocks the "New Civilian Profile" quick
// intake form uses to generate a plausible-looking vehicle + citation
// history in one click, instead of an FTO typing every field out by hand.
// None of this is meant to be precise — it just needs to look like a real
// training record.

// Every generated "previous citation" is the same offense — IC 418,
// Prohibited Parking, straight from the seeded Penal Code reference table
// (see sql/seed.js) — so an FTO doesn't have to pick or explain a specific
// violation, just how many. routes/admin.js files each one as a real
// Infraction Report (with this code attached) the same way the "paste a
// narrative" flow does, so the label text itself — including the offense-
// count suffix — comes from models.buildInfractionCodeLabel, not from here.
const PROHIBITED_PARKING_CODE = '418';
const PROHIBITED_PARKING_TITLE = 'Prohibited Parking';

// IC 418's real fine is tiered by offense count, not one flat number — which
// is exactly why the seeded PenalCode reference table leaves its own
// fineAmount at $0 rather than guessing (see sql/seed.js): $1,000 for a
// first offense, $2,500 for a second, $5,000 for a third (the form only
// offers up to three). A brand-new civilian profile has no prior IC 418s
// yet, so "offense number" here is just this batch's own citations in
// chronological order — see the sort-by-date step in
// generateCitationHistory below, since the random dates aren't generated in
// date order.
const PROHIBITED_PARKING_FINES = [1000, 2500, 5000];

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

// One generated { amount, status, timestamp } per requested prior citation,
// with the $1,000/$2,500/$5,000 offense-tiered fine lined up against each
// citation's actual date (earliest = first offense) rather than the order
// it happens to be generated in. status is randomly Paid or Unpaid — the
// FTO doesn't pick this per-citation, just how many to add; the matching
// Infraction Report for each one takes its Open/Closed status from this
// same coin flip, so the two stay in sync (see routes/admin.js).
function generateCitationHistory(count) {
  const dates = [];
  for (let i = 0; i < count; i++) dates.push(randomPastCitationDate());
  dates.sort((a, b) => a - b);

  return dates.map((timestamp, i) => ({
    amount: PROHIBITED_PARKING_FINES[Math.min(i, PROHIBITED_PARKING_FINES.length - 1)],
    status: Math.random() < 0.5 ? 'Paid' : 'Unpaid',
    timestamp,
  }));
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
  PROHIBITED_PARKING_CODE,
  PROHIBITED_PARKING_TITLE,
  generateCitationHistory,
  randomRecentExpirationDate,
  generateFakeVin,
  randomVehicleColor,
};
