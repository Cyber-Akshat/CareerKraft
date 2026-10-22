const crypto = require('node:crypto');

const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_POLICY_MESSAGE = 'Use 15–128 characters. Choose a unique password or passphrase, avoiding common passwords and repeated patterns.';
const SCRYPT_COST = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
const LEGACY_COST = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
const HASH_BYTES = 64;
const MAX_ACTIVE_HASHES = 2;
const MAX_QUEUED_HASHES = 16;
const COMMON_PASSWORDS = new Set([
  'passwordpassword', 'passwordpassword123', 'password123456789',
  '123456789012345', '1234567890123456', '12345678901234567890',
  'qwertyuiopasdfgh', 'qwertyuiopasdfghjkl', 'qwertyuiop123456',
  'thisismypassword', 'thisisapassword', 'mysecretpassword',
  'iloveyouiloveyou', 'letmeinletmein', 'welcomewelcomewelcome',
  'changemechangeme', 'adminadminadmin', 'correcthorsebatterystaple'
]);
const COMMON_PASSWORD_ROOT = /^(?:password|passw0rd|qwerty|letmein|welcome|admin|administrator|iloveyou|changeme|secret|careerkr[a@]ft)[\d\W_]*$/iu;

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return false;
  // These comparisons screen obvious choices only. The value passed to scrypt
  // always retains its original whitespace, Unicode and letter case.
  const comparable = password.toLowerCase().replace(/\s/g, '');
  const withoutSuffix = comparable.replace(/[\d\W_]+$/u, '');
  if (!comparable || COMMON_PASSWORDS.has(comparable) || COMMON_PASSWORDS.has(withoutSuffix) || COMMON_PASSWORD_ROOT.test(comparable)) return false;
  for (let length = 1; length <= Math.min(8, Math.floor(comparable.length / 2)); length += 1) {
    if (comparable.length % length === 0 && comparable.slice(0, length).repeat(comparable.length / length) === comparable) return false;
  }
  return true;
}

class PasswordBusyError extends Error {
  constructor() {
    super('Authentication is busy. Please try again shortly.');
    this.name = 'PasswordBusyError';
    this.code = 'AUTH_BUSY';
  }
}

let activeHashes = 0;
const hashQueue = [];
function boundedDerive(password, salt, parameters) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeHashes += 1;
      const release = () => {
        activeHashes -= 1;
        hashQueue.shift()?.();
      };
      try {
        crypto.scrypt(password, salt, HASH_BYTES, parameters, (error, derived) => {
          release();
          if (error) reject(error);
          else resolve(derived);
        });
      } catch (error) {
        release();
        reject(error);
      }
    };
    if (activeHashes < MAX_ACTIVE_HASHES) run();
    else if (hashQueue.length < MAX_QUEUED_HASHES) hashQueue.push(run);
    else reject(new PasswordBusyError());
  });
}

function encodeHash(salt, derived) {
  return `scrypt$v1$${SCRYPT_COST.N}$${SCRYPT_COST.r}$${SCRYPT_COST.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

// The random dummy record has the exact production format and work factor. It
// never authenticates anyone; it only equalizes missing/corrupt-record work.
const dummyPasswordHash = encodeHash(crypto.randomBytes(32), crypto.randomBytes(HASH_BYTES));
function parseStoredPassword(stored) {
  if (typeof stored !== 'string' || stored.length > 512) return null;
  // Do not pass parameters read from storage directly to scrypt. Only the exact
  // supported version/cost is accepted, so damaged records cannot request more
  // memory or CPU. New algorithms or costs require an explicit parser update.
  const current = /^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{64})\$([a-f0-9]{128})$/.exec(stored);
  if (current && current[0].length === stored.length) return {
    salt: Buffer.from(current[1], 'hex'), expected: Buffer.from(current[2], 'hex'),
    parameters: SCRYPT_COST, legacy: false
  };
  // The original implementation passed its textual salt directly to scrypt.
  // Retain this behavior while restricting its size and the 64-byte hash shape.
  const legacy = /^([A-Za-z0-9_-]{8,128}):([a-f0-9]{128})$/.exec(stored);
  if (legacy && legacy[0].length === stored.length) return {
    salt: legacy[1], expected: Buffer.from(legacy[2], 'hex'), parameters: LEGACY_COST, legacy: true
  };
  return null;
}
const dummyRecord = parseStoredPassword(dummyPasswordHash);

async function hashPassword(password) {
  // Callers apply validateNewPassword when a user chooses a new password.
  // Hashing itself also supports authenticated legacy passwords during upgrade,
  // even when their length or quality no longer satisfies the creation policy.
  if (typeof password !== 'string' || password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
    const error = new Error('Password must contain 1–128 characters.');
    error.code = 'INVALID_PASSWORD';
    throw error;
  }
  const salt = crypto.randomBytes(32);
  const derived = await boundedDerive(password, salt, SCRYPT_COST);
  try { return encodeHash(salt, derived); }
  finally { derived.fill(0); }
}

async function verifyPassword(password, stored) {
  const inputValid = typeof password === 'string' && password.length >= 1 && password.length <= PASSWORD_MAX_LENGTH;
  const parsed = inputValid ? parseStoredPassword(stored) : null;
  const record = parsed || dummyRecord;
  if (parsed?.legacy) {
    // A legacy failure must not take only the old, much cheaper work factor:
    // otherwise its timing would disclose which emails have older accounts.
    const padding = await boundedDerive(password, dummyRecord.salt, SCRYPT_COST);
    try { crypto.timingSafeEqual(padding, dummyRecord.expected); }
    finally { padding.fill(0); }
  }
  // Never let arbitrarily sized or non-string input reach the expensive worker.
  const derived = await boundedDerive(inputValid ? password : 'invalid-password-input', record.salt, record.parameters);
  try {
    const matches = crypto.timingSafeEqual(derived, record.expected);
    const valid = Boolean(inputValid && parsed && matches);
    return { valid, needsRehash: Boolean(valid && parsed.legacy) };
  } finally { derived.fill(0); }
}

module.exports = {
  hashPassword, verifyPassword, validateNewPassword, dummyPasswordHash,
  PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_POLICY_MESSAGE, PasswordBusyError
};
