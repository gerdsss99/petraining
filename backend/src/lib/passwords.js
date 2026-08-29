const crypto = require('crypto');

// Alphabet deliberately drops characters that are easy to mis-type or
// mis-read off a screen when an FTO hands this to someone verbally or on a
// sticky note: no 0/O, no 1/I/l, no vowel-adjacent lookalikes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// A one-time temporary password handed out when an admin/FTO creates a new
// login account. It's only ever shown once, right after creation — the
// server never stores or logs the plaintext, only its bcrypt hash — and the
// account is flagged mustChangePassword so the recipient is forced onto the
// change-password screen before they can do anything else.
function generateTempPassword(length = 10) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

module.exports = { generateTempPassword };
