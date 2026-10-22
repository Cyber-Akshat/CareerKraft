const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { isIP } = require('node:net');
const path = require('node:path');
const { ipKeyGenerator } = require('express-rate-limit');

const MINUTE = 60000;
const LIMITS = Object.freeze(Object.fromEntries(Object.entries({
  loginIP: { limit: 20, windowMs: 15 * MINUTE },
  loginAccount: { limit: 10, windowMs: 15 * MINUTE },
  registrationIP: { limit: 5, windowMs: 60 * MINUTE },
  registrationAccount: { limit: 3, windowMs: 60 * MINUTE },
  emailIP: { limit: 5, windowMs: 15 * MINUTE },
  emailAccount: { limit: 3, windowMs: 15 * MINUTE },
  tokenIP: { limit: 20, windowMs: 15 * MINUTE },
  oauthIP: { limit: 20, windowMs: 15 * MINUTE }
}).map(([name, value]) => [name, Object.freeze(value)])));
const RATE_LIMIT_RESPONSE = Object.freeze({
  error: 'Too many requests. Please try again later.', code: 'rate_limited'
});
const PUBLIC_HTML_FILES = ['index.html', 'terms.html', 'privacy.html', 'auth.html', 'verify-email.html',
  'onboarding.html', 'career.html', 'dashboard.html', 'activity.html',
  'reset-password.html', 'settings.html', 'signup.html', '404.html'];

function collectInlineScriptHashes(filenames = PUBLIC_HTML_FILES) {
  const hashes = new Set();
  for (const filename of filenames) {
    // Only repository-owned public HTML is inspected; request paths are never used.
    if (typeof filename !== 'string' || !/^(?:[a-z-]+|404)\.html$/.test(filename)) throw new TypeError('Invalid public HTML filename.');
    let html;
    try { html = readFileSync(path.join(__dirname, filename), 'utf8').replace(/\r\n?/g, '\n'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) continue;
      hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
    }
  }
  return [...hashes];
}

function buildContentSecurityPolicy({ production = false, base = '', scriptHashes = [] } = {}) {
  const hashes = scriptHashes.map(value => typeof value === 'string' ? value.replace(/^'|'$/g, '') : '')
    .filter(value => /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(value))
    .map(value => `'${value}'`);
  const directives = [
    "default-src 'self'",
    `script-src 'self' ${[...new Set(hashes)].join(' ')}`.trim(),
    // Existing stylesheets import Google Fonts and the app updates inline styles.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'"
  ];
  if (production && /^https:\/\//i.test(base)) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function accountIdentity(value) {
  if (typeof value !== 'string') return 'invalid-account';
  const email = value.trim().toLowerCase();
  return email.length <= 254 && !/[\u0000-\u001f\u007f]/.test(email) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : 'invalid-account';
}

function requestIP(req) {
  // Express resolves req.ip according to the app's explicit trust-proxy setting.
  // Never inspect X-Forwarded-For here or infer trust from a supplied header.
  const ip = req.ip || req.socket?.remoteAddress;
  return typeof ip === 'string' && isIP(ip) ? ipKeyGenerator(ip) : 'unknown-ip';
}

function rateKey(purpose, identity) {
  return createHash('sha256').update('careerkraft-auth-rate-limit\0').update(purpose)
    .update('\0').update(identity).digest('hex');
}

function validateJsonBody(req, res, next) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && contentType === 'application/json' &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
       Object.getPrototypeOf(req.body) !== Object.prototype)) {
    return res.status(400).json({ error: 'Invalid request.', code: 'invalid_request' });
  }
  next();
}

function createAuthSecurity({ db, production = false, base = '', options = {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_reset ON auth_rate_limits(reset_at);`);
  const overrides = options.authSecurityLimits || {};
  const limits = {};
  for (const [name, defaultValue] of Object.entries(LIMITS)) {
    const supplied = overrides[name];
    const value = typeof supplied === 'number' ? { ...defaultValue, limit: supplied }
      : supplied === undefined ? defaultValue : { ...defaultValue, ...supplied };
    if (!Number.isSafeInteger(value.limit) || value.limit < 1 ||
        !Number.isSafeInteger(value.windowMs) || value.windowMs < 1) throw new TypeError(`Invalid ${name} rate limit.`);
    limits[name] = value;
  }
  const maxKeys = options.authSecurityMaxKeys ?? 10000;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new TypeError('Invalid authentication rate-limit capacity.');
  const now = options.authSecurityNow || Date.now;
  if (typeof now !== 'function') throw new TypeError('Invalid authentication clock.');
  const find = db.prepare('SELECT count,reset_at FROM auth_rate_limits WHERE key=?');
  const rowCount = db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits');
  const oldestReset = db.prepare('SELECT MIN(reset_at) AS reset_at FROM auth_rate_limits');
  const cleanup = db.prepare('DELETE FROM auth_rate_limits WHERE reset_at<=?');
  const increment = db.prepare(`INSERT INTO auth_rate_limits(key,count,reset_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN auth_rate_limits.reset_at<=? THEN 1 ELSE auth_rate_limits.count+1 END,
      reset_at=CASE WHEN auth_rate_limits.reset_at<=? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END
    RETURNING count,reset_at`);
  let lastCleanup = -Infinity;

  function reject(res, retryAfter) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json(RATE_LIMIT_RESPONSE);
  }

  function limiter(...buckets) {
    return function durableAuthLimit(req, res, next) {
      let inTransaction = false;
      let retryAfter = null;
      let cleanedAt = null;
      try {
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid authentication clock.');
        db.exec('BEGIN IMMEDIATE');
        inTransaction = true;
        if (timestamp - lastCleanup >= MINUTE || timestamp < lastCleanup) {
          cleanup.run(timestamp);
          cleanedAt = timestamp;
        }
        for (const name of buckets) {
          const { limit, windowMs } = limits[name];
          const identity = name.endsWith('Account') ? accountIdentity(req.body?.email) : requestIP(req);
          const key = rateKey(name, identity);
          if (!find.get(key) && rowCount.get().count >= maxKeys) {
            // Reclaim expired windows before refusing new identities. Capacity is
            // checked inside the same write transaction as the atomic increment.
            cleanup.run(timestamp);
            cleanedAt = timestamp;
            if (rowCount.get().count >= maxKeys) {
              retryAfter = Math.max(1, ((oldestReset.get().reset_at || timestamp + MINUTE) - timestamp) / 1000);
              break;
            }
          }
          const row = increment.get(key, timestamp + windowMs, timestamp, timestamp);
          if (row.count > limit) {
            retryAfter = (row.reset_at - timestamp) / 1000;
            // An already-blocked IP cannot allocate arbitrary account buckets.
            break;
          }
        }
        db.exec('COMMIT');
        inTransaction = false;
        if (cleanedAt !== null) lastCleanup = cleanedAt;
      } catch {
        if (inTransaction) { try { db.exec('ROLLBACK'); } catch {} }
        // A busy/unavailable persistent store must not disable authentication limits.
        return reject(res, 60);
      }
      if (retryAfter !== null) return reject(res, retryAfter);
      next();
    };
  }

  const scriptHashes = [...collectInlineScriptHashes(options.authSecurityHtmlFiles), ...(options.cspScriptHashes || [])];
  const csp = buildContentSecurityPolicy({ production, base, scriptHashes });
  function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', csp);
    if (production && /^https:\/\//i.test(base)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  }

  return {
    loginLimit: limiter('loginIP', 'loginAccount'),
    registrationLimit: limiter('registrationIP', 'registrationAccount'),
    emailLimit: limiter('emailIP', 'emailAccount'),
    tokenLimit: limiter('tokenIP'),
    oauthLimit: limiter('oauthIP'),
    securityHeaders, validateJsonBody
  };
}

module.exports = { createAuthSecurity, LIMITS, RATE_LIMIT_RESPONSE, collectInlineScriptHashes, buildContentSecurityPolicy };
