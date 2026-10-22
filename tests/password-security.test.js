const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const {
  hashPassword, verifyPassword, validateNewPassword, dummyPasswordHash,
  PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_POLICY_MESSAGE, PasswordBusyError
} = require('../password-security');

const phrase = '  Café sailors cross snowy rivers!  ';
const derive = promisify(crypto.scrypt);
const cost = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };

test('password policy accepts passphrases and exact Unicode/whitespace, screening common and repeated choices', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 15);
  assert.equal(PASSWORD_MAX_LENGTH, 128);
  assert.match(PASSWORD_POLICY_MESSAGE, /15.*128/);
  for (const value of [phrase, 'a river beneath starlight', '雪の夜を歩く travellers and owls!',
    ('Unique moonlit pathways! '.repeat(6)).slice(0, 128)]) assert.equal(validateNewPassword(value), true, value);
  for (const value of [undefined, null, 42, {}, 'short password', 'x'.repeat(129),
    'Password123456789!', 'passwordpassword', 'PasswordPassword123!', '  passwordpassword  ', 'qwertyuiopasdfghjkl',
    'correct horse battery staple', 'abababababababab', 'abc123abc123abc123', '😀'.repeat(10), ' '.repeat(20)]) {
    assert.equal(validateNewPassword(value), false, String(value));
  }
});

test('new hashes use independent random salts and the real versioned production scrypt parameters', async () => {
  const [first, second] = await Promise.all([hashPassword(phrase), hashPassword(phrase)]);
  const shape = /^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{64})\$([a-f0-9]{128})$/;
  assert.match(first, shape);
  assert.match(second, shape);
  assert.notEqual(first, second);
  const firstParts = first.match(shape);
  const secondParts = second.match(shape);
  assert.notEqual(firstParts[1], secondParts[1]);
  assert.notEqual(firstParts[2], secondParts[2]);
  const independentlyDerived = await derive(phrase, Buffer.from(firstParts[1], 'hex'), 64, cost);
  assert.equal(independentlyDerived.toString('hex'), firstParts[2]);
  independentlyDerived.fill(0);
  assert.deepEqual(await verifyPassword(phrase, first), { valid: true, needsRehash: false });
  assert.deepEqual(await verifyPassword(phrase.trim(), first), { valid: false, needsRehash: false });
  assert.deepEqual(await verifyPassword(phrase.normalize('NFD'), first), { valid: false, needsRehash: false });
});

test('legacy passwords retain their original verification plus production-cost timing work and request upgrade', async t => {
  const salt = crypto.randomBytes(32).toString('hex');
  const previous = 'old';
  const legacy = `${salt}:${(await derive(previous, salt, 64, { N: 16384, r: 8, p: 1 })).toString('hex')}`;
  const originalScrypt = crypto.scrypt;
  const requestedCosts = [];
  t.mock.method(crypto, 'scrypt', (input, inputSalt, length, options, callback) => {
    requestedCosts.push(options.N);
    return originalScrypt(input, inputSalt, length, options, callback);
  });
  assert.equal(validateNewPassword(previous), false);
  assert.deepEqual(await verifyPassword(previous, legacy), { valid: true, needsRehash: true });
  assert.deepEqual(requestedCosts, [131072, 16384]);
  assert.deepEqual(await verifyPassword('incorrect', legacy), { valid: false, needsRehash: false });
  assert.deepEqual(requestedCosts, [131072, 16384, 131072, 16384]);
  const replacement = await hashPassword(previous);
  assert.deepEqual(await verifyPassword(previous, replacement), { valid: true, needsRehash: false });
});

test('corrupt or missing password records fail closed with bounded production-cost dummy work', async t => {
  const originalScrypt = crypto.scrypt;
  const requested = [];
  t.mock.method(crypto, 'scrypt', (input, salt, length, options, callback) => {
    requested.push({ length, options, inputLength: input.length, saltLength: salt.length });
    return originalScrypt(input, salt, length, options, callback);
  });
  const malformed = [undefined, null, '', 'not-a-hash', 'scrypt$v2$131072$8$1$' + 'a'.repeat(64) + '$' + 'b'.repeat(128),
    'scrypt$v1$2147483648$8$1$' + 'a'.repeat(64) + '$' + 'b'.repeat(128),
    'scrypt$v1$131072$999999$1$' + 'a'.repeat(64) + '$' + 'b'.repeat(128),
    'scrypt$v1$131072$8$1$bad$hash', dummyPasswordHash + '\n', 's'.repeat(64) + ':' + 'f'.repeat(126), 'a'.repeat(100000)];
  for (const stored of malformed) assert.deepEqual(await verifyPassword(phrase, stored), { valid: false, needsRehash: false });
  for (const input of [undefined, {}, '', 'x'.repeat(100000)]) {
    assert.deepEqual(await verifyPassword(input, dummyPasswordHash), { valid: false, needsRehash: false });
  }
  assert.equal(requested.length, malformed.length + 4);
  for (const request of requested) {
    assert.equal(request.length, 64);
    assert.equal(request.saltLength, 32);
    assert.deepEqual(request.options, cost);
    assert.ok(request.inputLength <= PASSWORD_MAX_LENGTH);
  }
});

test('hashing caps active work and queue depth, rejects excess load, and recovers capacity', async t => {
  const originalScrypt = crypto.scrypt;
  let active = 0;
  let peak = 0;
  let count = 0;
  t.mock.method(crypto, 'scrypt', (input, salt, length, options, callback) => {
    count += 1;
    active += 1;
    peak = Math.max(peak, active);
    return originalScrypt(input, salt, length, options, (error, output) => {
      active -= 1;
      callback(error, output);
    });
  });
  // Real production derivations exercise backpressure without lowering the work
  // factor. Calls above the two active + sixteen queued limit fail immediately.
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => verifyPassword(phrase, null)));
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 2);
  for (const result of rejected) {
    assert.ok(result.reason instanceof PasswordBusyError);
    assert.equal(result.reason.code, 'AUTH_BUSY');
    assert.ok(!result.reason.message.includes(phrase));
  }
  assert.equal(peak, 2);
  assert.equal(count, 18);
  assert.equal(active, 0);
  for (const result of results.filter(result => result.status === 'fulfilled')) {
    assert.deepEqual(result.value, { valid: false, needsRehash: false });
  }
  assert.deepEqual(await verifyPassword(phrase, undefined), { valid: false, needsRehash: false });
  assert.equal(active, 0);
});

test('invalid hashing inputs never schedule a derivation', async t => {
  const calls = t.mock.method(crypto, 'scrypt', () => { throw new Error('No hashing expected.'); });
  await assert.rejects(hashPassword(''), { code: 'INVALID_PASSWORD' });
  await assert.rejects(hashPassword('x'.repeat(129)), { code: 'INVALID_PASSWORD' });
  await assert.rejects(hashPassword({}), { code: 'INVALID_PASSWORD' });
  assert.equal(calls.mock.callCount(), 0);
});
