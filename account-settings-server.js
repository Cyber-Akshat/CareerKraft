const path = require('node:path');
const { mkdirSync, writeFileSync, unlinkSync } = require('node:fs');
const { spawn } = require('node:child_process');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const { inspectEvidenceFile } = require('./evidence-files');
const avatarCharacters = require('./assets/avatar-characters');
const { hashPassword, verifyPassword, validateNewPassword, PASSWORD_MAX_LENGTH, PASSWORD_POLICY_MESSAGE } = require('./password-security');

// Only the application-owned catalog can select files for built-in avatars.
const characterImages = new Map(avatarCharacters.filter(character =>
  typeof character.id === 'string' && /^[a-z]+$/.test(character.id) &&
  character.imageUrl === `/assets/avatars/${character.id}.png`
).map(character => [character.id, path.join(__dirname, 'assets', 'avatars', `${character.id}.png`)]));

const REAUTH_LIFETIME = 10 * 60000;
const AVATAR_LIMIT = 2 * 1024 * 1024;

const preferenceFields = {
  theme: { column: 'theme', values: ['light', 'dark'] },
  reducedMotion: { column: 'reduced_motion', boolean: true },
  dyslexiaFont: { column: 'dyslexia_font', boolean: true },
  fontSize: { column: 'font_size', values: ['small', 'default', 'large'] },
  contrast: { column: 'contrast', values: ['default', 'high'] },
  saturation: { column: 'saturation', values: ['default', 'low', 'high', 'grayscale'] },
  cursorSize: { column: 'cursor_size', values: ['small', 'default', 'large'] }
};

function preferencesFor(settings) {
  return {
    theme: settings?.theme || null,
    reducedMotion: Boolean(settings?.reduced_motion),
    dyslexiaFont: Boolean(settings?.dyslexia_font),
    fontSize: settings?.font_size || 'default',
    contrast: settings?.contrast || 'default',
    saturation: settings?.saturation || 'default',
    cursorSize: settings?.cursor_size || 'default'
  };
}

// Decode and re-encode uploaded photos, removing metadata and arbitrary trailing
// content. Both tools receive bytes through stdin and never resolve user URLs.
function imageProcess(executable, args, input, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let failure;
    const timer = setTimeout(() => { failure = new Error('Image processing timed out.'); child.kill(); }, 10000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { failure = new Error('Image is too large.'); child.kill(); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure || new Error('Image could not be decoded.'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

async function normalizeAvatar(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const formats = { '.png': 'png_pipe', '.jpg': 'jpeg_pipe', '.jpeg': 'jpeg_pipe', '.webp': 'webp_pipe' };
  if (!formats[extension]) throw new Error('Choose a PNG, JPG or WebP image.');
  await inspectEvidenceFile(file);
  const input = ['-v', 'error', '-protocol_whitelist', 'pipe', '-f', formats[extension], '-i', 'pipe:0'];
  const probe = JSON.parse((await imageProcess(require('ffprobe-static').path,
    [...input, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json'], file.buffer, 16000)).toString());
  const { width, height } = probe.streams?.[0] || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || width * height > 16000000) throw new Error('Image dimensions are too large.');
  const result = await imageProcess(require('ffmpeg-static'),
    ['-xerror', '-err_detect', 'explode', ...input, '-frames:v', '1', '-vf',
      'scale=512:512:force_original_aspect_ratio=decrease', '-threads', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], file.buffer, 4 * 1024 * 1024);
  if (!result.length) throw new Error('Image could not be decoded.');
  return result;
}

function installAccountSettings({ app, db, options, base, production, dataDir, currentUser, requireUser,
  getCookie, token, digest, normalizeEmail, validEmail, send, emailLimit,
  startSession, rotateSession, clearSessionCookie, oauthLimit, removeEvidenceFile }) {
  if (db.dialect !== 'mysql') {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme TEXT CHECK(theme IN ('light','dark')), reduced_motion INTEGER NOT NULL DEFAULT 0,
        avatar_key TEXT, avatar_version TEXT, updated_at INTEGER NOT NULL, avatar_character TEXT
      );
      CREATE TABLE IF NOT EXISTS settings_email_changes (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        hash TEXT UNIQUE NOT NULL, old_email TEXT NOT NULL, new_email TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_session_verifications (
        session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE,
        verified_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_oauth_states (
        hash TEXT PRIMARY KEY, intent TEXT NOT NULL, nonce TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        session_hash TEXT REFERENCES sessions(hash) ON DELETE CASCADE,
        expires INTEGER NOT NULL, next_path TEXT
      );
    `);
    if (!db.prepare('PRAGMA table_info(settings_oauth_states)').all().some(column => column.name === 'next_path')) {
      db.exec('ALTER TABLE settings_oauth_states ADD COLUMN next_path TEXT');
    }
    if (!db.prepare('PRAGMA table_info(account_settings)').all().some(column => column.name === 'avatar_character')) {
      db.exec('ALTER TABLE account_settings ADD COLUMN avatar_character TEXT');
    }
    // Additive migrations keep existing accounts and avatar selections intact.
    const settingsColumns = new Set(db.prepare('PRAGMA table_info(account_settings)').all().map(column => column.name));
    const accessibilityColumns = {
      dyslexia_font: 'INTEGER NOT NULL DEFAULT 0 CHECK(dyslexia_font IN (0,1))',
      font_size: "TEXT NOT NULL DEFAULT 'default' CHECK(font_size IN ('small','default','large'))",
      contrast: "TEXT NOT NULL DEFAULT 'default' CHECK(contrast IN ('default','high'))",
      saturation: "TEXT NOT NULL DEFAULT 'default' CHECK(saturation IN ('default','low','high','grayscale'))",
      cursor_size: "TEXT NOT NULL DEFAULT 'default' CHECK(cursor_size IN ('small','default','large'))"
    };
    for (const [column, definition] of Object.entries(accessibilityColumns)) {
      if (!settingsColumns.has(column)) db.exec(`ALTER TABLE account_settings ADD COLUMN ${column} ${definition}`);
    }
    if (!settingsColumns.has('preferences_saved')) {
      db.exec('ALTER TABLE account_settings ADD COLUMN preferences_saved INTEGER NOT NULL DEFAULT 0 CHECK(preferences_saved IN (0,1))');
    }
    if (!settingsColumns.has('dashboard_tour_seen')) {
      db.exec('ALTER TABLE account_settings ADD COLUMN dashboard_tour_seen INTEGER NOT NULL DEFAULT 0 CHECK(dashboard_tour_seen IN (0,1))');
    }
    db.exec(`UPDATE account_settings SET preferences_saved=1 WHERE preferences_saved=0 AND
      (theme IS NOT NULL OR reduced_motion<>0 OR dyslexia_font<>0 OR font_size<>'default'
        OR contrast<>'default' OR saturation<>'default' OR cursor_size<>'default')`);
  }
  const avatarDirectory = path.resolve(options.avatarUploadDir || path.join(dataDir, 'avatars'));
  mkdirSync(avatarDirectory, { recursive: true });
  const googleConfigured = Boolean(options.googleClient || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET));
  const google = options.googleClient || new OAuth2Client(process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET, `${base}/api/google/callback`);
  const sessionHash = req => digest(getCookie(req, 'ck_session'));
  const savedSettings = async id => await db.prepare('SELECT * FROM account_settings WHERE user_id=?').get(id);
  const settingsFor = async (user, req, activeSessionHash = sessionHash(req)) => {
    const settings = await savedSettings(user.id);
    const character = characterImages.has(settings?.avatar_character) ? settings.avatar_character : null;
    const profile = await db.prepare('SELECT display_name FROM profiles WHERE user_id=?').get(user.id);
    const verified = await db.prepare('SELECT verified_at FROM settings_session_verifications WHERE session_hash=?').get(activeSessionHash);
    return {
      displayName: profile?.display_name || user.name,
      email: user.email,
      avatarUrl: settings?.avatar_key || character ? `/api/settings/avatar?version=${settings.avatar_version}` : null,
      avatarCharacter: character,
      hasPassword: Boolean(user.password), googleLinked: Boolean(user.google_sub), googleConfigured,
      securityVerified: Boolean(verified && verified.verified_at > Date.now() - REAUTH_LIFETIME),
      dashboardTourSeen: Boolean(settings?.dashboard_tour_seen),
      ...preferencesFor(settings), createdAt: user.created_at
    };
  };
  const reply = async (res, user, req, extra = {}, activeSessionHash) => {
    if (!user) return res.status(401).json({ error: 'Sign in to continue.' });
    return res.json({ success: true, settings: await settingsFor(user, req, activeSessionHash), ...extra });
  };
  const freshUser = async user => await db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  async function consumeOAuthState(state) {
    await db.exec('BEGIN IMMEDIATE');
    try {
      // MySQL has no DELETE RETURNING; lock the state until its deletion commits
      // so simultaneous callbacks cannot redeem the same authorization flow.
      const flow = await db.prepare(`SELECT * FROM settings_oauth_states
        WHERE hash=? AND expires>?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`)
        .get(digest(state), Date.now());
      if (flow) await db.prepare('DELETE FROM settings_oauth_states WHERE hash=?').run(digest(state));
      await db.exec('COMMIT');
      return flow;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  const avatarPath = key => /^[a-f0-9]{64}$/.test(key || '') ? path.join(avatarDirectory, key) : null;
  function removeAvatar(key) {
    const filename = avatarPath(key);
    if (!filename) return;
    try { unlinkSync(filename); }
    catch (error) { if (error.code !== 'ENOENT') console.error('Could not remove an account photo.'); }
  }
  async function writeSettings(userId, values) {
    // Each caller supplies application-owned column names. Updating only those
    // columns preserves preferences saved by another request while SQL is pending.
    const updated = { ...values, updated_at: Date.now() };
    const columns = Object.keys(updated);
    await db.prepare(`INSERT INTO account_settings(user_id,${columns.join(',')})
      VALUES (?,${columns.map(() => '?').join(',')}) ON CONFLICT(user_id) DO UPDATE SET
      ${columns.map(column => `${column}=excluded.${column}`).join(',')}`)
      .run(userId, ...Object.values(updated));
  }
  async function sensitiveUser(req, res) {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (user.password) {
      const password = req.body.currentPassword;
      if (typeof password !== 'string' || password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
        res.status(401).json({ error: 'Enter your current password.', code: 'incorrect_password' }); return null;
      }
      if (!(await verifyPassword(password, user.password)).valid) {
        res.status(401).json({ error: 'Your current password is incorrect.', code: 'incorrect_password' }); return null;
      }
    } else if (!user.google_sub || !(await settingsFor(user, req)).securityVerified) {
      res.status(403).json({ error: 'Verify your identity with Google before making this change.', code: 'reauth_required' }); return null;
    }
    // Password hashing yields to other requests: recheck session and credentials.
    const current = await currentUser(req);
    if (!current || current.id !== user.id || current.password !== user.password || current.google_sub !== user.google_sub) {
      res.status(401).json({ error: 'Your account changed. Sign in and try again.' }); return null;
    }
    return current;
  }
  async function lockSensitiveUser(req, user) {
    // Proof may have been checked before another request changed credentials.
    // Keep that account locked until the enclosing security change commits.
    const current = await db.prepare(`SELECT * FROM users WHERE id=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(user.id);
    const active = await currentUser(req);
    return active && current && active.id === user.id && current.password === user.password &&
      current.google_sub === user.google_sub && current.email === user.email ? current : null;
  }
  const securityLimit = rateLimit({ windowMs: 15 * 60000, limit: 20,
    message: { error: 'Too many security requests. Try again later.' }, standardHeaders: 'draft-8', legacyHeaders: false });
  app.get('/api/settings', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ settings: await settingsFor(user, req), stats: {
      completedActivities: (await db.prepare("SELECT COUNT(*) AS count FROM roadmap_progress WHERE user_id=? AND status='completed'").get(user.id)).count,
      verifiedSkills: (await db.prepare('SELECT COUNT(*) AS count FROM user_skills WHERE user_id=?').get(user.id)).count
    } });
  });
  app.post('/api/settings/dashboard-tour', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        !['completed', 'skipped'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Choose a valid dashboard tour status.' });
    }
    await writeSettings(user.id, { dashboard_tour_seen: 1 });
    res.json({ success: true, dashboardTourSeen: true });
  });
  app.post('/api/settings/profile', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const name = req.body.displayName;
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      return res.status(400).json({ error: 'Enter a display name of 1–100 characters.' });
    }
    await db.exec('BEGIN IMMEDIATE');
    try {
      await db.prepare('UPDATE users SET name=? WHERE id=?').run(name.trim(), user.id);
      await db.prepare(`INSERT INTO profiles(user_id,display_name,updated_at) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`).run(user.id, name.trim(), Date.now());
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    await reply(res, await freshUser(user), req);
  });
  app.post('/api/settings/preferences', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Choose valid appearance and accessibility preferences.' });
    }
    const values = {};
    for (const [field, definition] of Object.entries(preferenceFields)) {
      if (!Object.hasOwn(req.body, field)) continue;
      const value = req.body[field];
      if (definition.boolean ? typeof value !== 'boolean' : !definition.values.includes(value)) {
        return res.status(400).json({ error: 'Choose valid appearance and accessibility preferences.' });
      }
      values[definition.column] = definition.boolean ? Number(value) : value;
    }
    if (!Object.keys(values).length) return res.status(400).json({ error: 'Choose at least one appearance or accessibility preference.' });
    await writeSettings(user.id, { ...values, preferences_saved: 1 });
    await reply(res, user, req);
  });
  const avatarUpload = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: AVATAR_LIMIT, files: 1, fields: 0, parts: 1
  } }).single('avatar');
  app.post('/api/settings/avatar', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const uploadError = await new Promise(resolve => avatarUpload(req, res, resolve));
    if (uploadError) return res.status(uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Choose one PNG, JPG or WebP image, up to 2 MB.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a profile picture.' });
    let bytes;
    try { bytes = await normalizeAvatar(req.file); }
    catch { return res.status(400).json({ error: 'Choose a valid PNG, JPG or WebP image up to 2 MB and 16 megapixels.' }); }
    if (!(await currentUser(req)) || !(await freshUser(user))) return res.status(401).json({ error: 'Sign in to update your picture.' });
    const previous = await savedSettings(user.id);
    const key = token();
    try {
      writeFileSync(avatarPath(key), bytes, { flag: 'wx', mode: 0o600 });
      await writeSettings(user.id, { avatar_key: key, avatar_version: token().slice(0, 16), avatar_character: null });
    } catch {
      removeAvatar(key);
      return res.status(503).json({ error: 'Your profile picture could not be saved. Try again.' });
    }
    removeAvatar(previous?.avatar_key);
    await reply(res, await freshUser(user), req);
  });
  app.get('/api/settings/avatar', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const settings = await savedSettings(user.id);
    const filename = characterImages.get(settings?.avatar_character) || avatarPath(settings?.avatar_key);
    if (!filename) return res.status(404).json({ error: 'No profile picture has been uploaded.' });
    res.type('png').sendFile(filename, error => {
      if (error && !res.headersSent) res.status(404).json({ error: 'Profile picture is unavailable.' });
    });
  });
  app.post('/api/settings/avatar/character', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const characterId = req.body.characterId;
    if (typeof characterId !== 'string' || !characterImages.has(characterId)) {
      return res.status(400).json({ error: 'Choose a character from the avatar collection.' });
    }
    const previous = (await savedSettings(user.id))?.avatar_key;
    await writeSettings(user.id, { avatar_character: characterId, avatar_key: null, avatar_version: token().slice(0, 16) });
    removeAvatar(previous);
    await reply(res, user, req);
  });
  app.post('/api/settings/avatar/remove', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const old = (await savedSettings(user.id))?.avatar_key;
    await writeSettings(user.id, { avatar_key: null, avatar_version: null, avatar_character: null });
    removeAvatar(old);
    await reply(res, user, req);
  });
  app.post('/api/settings/password', securityLimit, async (req, res) => {
    const password = req.body.newPassword;
    if (!validateNewPassword(password)) return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    const user = await sensitiveUser(req, res);
    if (!user) return;
    const hash = await hashPassword(password);
    const current = await currentUser(req);
    if (!current || current.id !== user.id || current.password !== user.password || current.google_sub !== user.google_sub) {
      return res.status(401).json({ error: 'Sign in and try again.' });
    }
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (!await lockSensitiveUser(req, user)) {
        await db.exec('ROLLBACK');
        return res.status(401).json({ error: 'Sign in and try again.' });
      }
      await db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
      await db.prepare('DELETE FROM tokens WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM settings_email_changes WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM settings_session_verifications WHERE session_hash IN (SELECT hash FROM sessions WHERE user_id=?)').run(user.id);
      await db.prepare('DELETE FROM settings_oauth_states WHERE user_id=?').run(user.id);
      await rotateSession(res, req, await freshUser(user), { revokeOthers: true });
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    await reply(res, await freshUser(user), req);
  });
  app.post('/api/settings/email', securityLimit, emailLimit, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const user = await sensitiveUser(req, res);
    if (!user) return;
    if (email === user.email) return res.status(400).json({ error: 'Enter a different email address.' });
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'This email address is already in use.' });
    const value = token();
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (!await lockSensitiveUser(req, user)) {
        await db.exec('ROLLBACK');
        return res.status(401).json({ error: 'Sign in and try again.' });
      }
      await db.prepare(`INSERT INTO settings_email_changes(user_id,hash,old_email,new_email,expires) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash,old_email=excluded.old_email,
        new_email=excluded.new_email,expires=excluded.expires`).run(user.id, digest(value), user.email, email, Date.now() + 3600000);
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    const actionUrl = `${base}/settings.html?emailToken=${value}`;
    try {
      await send({ to: email, subject: 'Confirm your new CareerKraft email', actionUrl,
        text: `Hello ${user.name},\n\nConfirm your new email address using this link:\n${actionUrl}\n\nSign in to the CareerKraft account that requested this change. This link expires in 60 minutes and can be used once. If you did not request this change, ignore this email.` });
    } catch {
      await db.prepare('DELETE FROM settings_email_changes WHERE hash=?').run(digest(value));
      return res.status(503).json({ error: 'The confirmation email could not be sent. Your email address has not changed.' });
    }
    // The account may have been deleted while delivery was pending.
    const current = await currentUser(req);
    if (!current) return res.status(401).json({ error: 'Sign in to continue.' });
    await reply(res, current, req, { pendingEmail: email, message: 'Check your new email address for a confirmation link.' });
  });
  app.post('/api/settings/email/confirm', securityLimit, async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const value = req.body.token;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
    await db.exec('BEGIN IMMEDIATE');
    try {
      // Lock the account before its pending change, matching the order used by
      // credential changes that update the account and invalidate email tokens.
      const current = await db.prepare(`SELECT * FROM users WHERE id=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(user.id);
      const active = await currentUser(req);
      const pending = active?.id === user.id && current?.email === user.email
        ? await db.prepare(`SELECT * FROM settings_email_changes WHERE user_id=? AND hash=? AND expires>? AND old_email=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`)
          .get(user.id, digest(value), Date.now(), user.email) : null;
      if (!pending) {
        await db.exec('ROLLBACK');
        return res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
      }
      if (await db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(pending.new_email, user.id)) {
        await db.exec('ROLLBACK');
        return res.status(409).json({ error: 'This email address is already in use.' });
      }
      await db.prepare('UPDATE users SET email=? WHERE id=?').run(pending.new_email, user.id);
      if (await db.prepare('SELECT id FROM early_access WHERE email=?').get(pending.new_email)) await db.prepare('DELETE FROM early_access WHERE email=?').run(user.email);
      else await db.prepare('UPDATE early_access SET email=? WHERE email=?').run(pending.new_email, user.email);
      await db.prepare('DELETE FROM settings_email_changes WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM tokens WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM settings_session_verifications WHERE session_hash IN (SELECT hash FROM sessions WHERE user_id=?)').run(user.id);
      await db.prepare('DELETE FROM settings_oauth_states WHERE user_id=?').run(user.id);
      await rotateSession(res, req, await freshUser(user), { revokeOthers: true });
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This email address is already in use.' });
      throw error;
    }
    await reply(res, await freshUser(user), req);
  });
  app.post('/api/settings/sessions/revoke', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    await db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(user.id, sessionHash(req));
    await reply(res, user, req);
  });
  app.post('/api/settings/google/link', securityLimit, async (req, res) => {
    const user = await sensitiveUser(req, res);
    if (!user) return;
    if (!googleConfigured) return res.status(503).json({ error: 'Google sign-in has not been configured.', code: 'google_unconfigured' });
    let verifiedSessionHash;
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (!await lockSensitiveUser(req, user)) {
        await db.exec('ROLLBACK');
        return res.status(401).json({ error: 'Sign in and try again.' });
      }
      // Elevation belongs only to the freshly issued cookie. A copied pre-proof
      // session must not gain authority when its legitimate owner verifies.
      verifiedSessionHash = await rotateSession(res, req, user);
      await db.prepare('INSERT INTO settings_session_verifications(session_hash,verified_at) VALUES (?,?)')
        .run(verifiedSessionHash, Date.now());
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    await reply(res, user, req, { url: '/api/google?intent=link' }, verifiedSessionHash);
  });
  app.post('/api/settings/google/unlink', securityLimit, async (req, res) => {
    const user = await sensitiveUser(req, res);
    if (!user) return;
    if (!user.password) return res.status(400).json({ error: 'Set a password before disconnecting your only sign-in method.', code: 'password_required' });
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (!await lockSensitiveUser(req, user)) {
        await db.exec('ROLLBACK');
        return res.status(401).json({ error: 'Sign in and try again.' });
      }
      await db.prepare('UPDATE users SET google_sub=NULL WHERE id=?').run(user.id);
      await db.prepare('DELETE FROM settings_session_verifications WHERE session_hash IN (SELECT hash FROM sessions WHERE user_id=?)').run(user.id);
      await db.prepare('DELETE FROM settings_oauth_states WHERE user_id=?').run(user.id);
      await rotateSession(res, req, await freshUser(user), { revokeOthers: true });
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    await reply(res, await freshUser(user), req);
  });
  app.get('/api/settings/export', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const owned = async table => await db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).all(user.id);
    const roadmaps = await owned('roadmaps');
    const steps = await db.prepare('SELECT roadmap_steps.* FROM roadmap_steps JOIN roadmaps ON roadmaps.id=roadmap_steps.roadmap_id WHERE roadmaps.user_id=?').all(user.id);
    const content = await db.prepare(`SELECT roadmap_step_content.* FROM roadmap_step_content
      JOIN roadmap_steps ON roadmap_steps.id=roadmap_step_content.roadmap_step_id
      JOIN roadmaps ON roadmaps.id=roadmap_steps.roadmap_id WHERE roadmaps.user_id=?`).all(user.id);
    const notifications = await db.prepare('SELECT roadmap_level_notifications.* FROM roadmap_level_notifications JOIN roadmaps ON roadmaps.id=roadmap_level_notifications.roadmap_id WHERE roadmaps.user_id=?').all(user.id);
    const evidence = (await owned('evidence_submissions')).map(({ file_storage_key, ...submission }) => submission);
    res.attachment('careerkraft-account.json').json({ exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email, displayName: (await settingsFor(user, req)).displayName,
        createdAt: user.created_at, emailVerified: Boolean(user.verified), googleLinked: Boolean(user.google_sub),
        avatarCharacter: (await settingsFor(user, req)).avatarCharacter },
      preferences: preferencesFor(await savedSettings(user.id)),
      uiPreferences: { dashboardTourSeen: Boolean((await savedSettings(user.id))?.dashboard_tour_seen) },
      profile: (await owned('profiles'))[0] || null, assessments: await owned('career_assessments'), careerMatches: await owned('career_matches'),
      selectedCareer: (await owned('selected_career'))[0] || null, roadmaps, steps, moduleContent: content,
      progress: await owned('roadmap_progress'), levelNotifications: notifications, evidence,
      skills: await owned('user_skills'), skillVerifications: await owned('skill_verifications'),
      lumia: { conversations: await owned('lumia_conversations'), messages: await owned('lumia_messages') }
    });
  });
  app.post('/api/settings/delete', securityLimit, async (req, res) => {
    if (req.body.confirmation !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm account deletion.' });
    const user = await sensitiveUser(req, res);
    if (!user) return;
    let evidenceKeys;
    let avatar;
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (!await lockSensitiveUser(req, user)) {
        await db.exec('ROLLBACK');
        return res.status(401).json({ error: 'Sign in and try again.' });
      }
      evidenceKeys = await db.prepare('SELECT file_storage_key FROM evidence_submissions WHERE user_id=?').all(user.id);
      avatar = (await savedSettings(user.id))?.avatar_key;
      // Legacy token/session foreign keys do not cascade.
      await db.prepare('DELETE FROM tokens WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM early_access WHERE email=?').run(user.email);
      await db.prepare('DELETE FROM users WHERE id=?').run(user.id);
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    for (const row of evidenceKeys) {
      // Never remove another account's attachment if old database data reused a key.
      if (!(await db.prepare('SELECT id FROM evidence_submissions WHERE file_storage_key=?').get(row.file_storage_key))) removeEvidenceFile(row.file_storage_key);
    }
    removeAvatar(avatar);
    clearSessionCookie(res);
    res.json({ success: true });
  });
  app.get('/api/google', oauthLimit, async (req, res) => {
    const intent = req.query.intent || 'login';
    if (!['login', 'link', 'reauth'].includes(intent)) return res.redirect('/settings.html?error=google_failed');
    const settingsIntent = intent !== 'login';
    const failurePage = settingsIntent ? '/settings.html' : '/auth.html';
    const user = settingsIntent ? await currentUser(req) : null;
    if (settingsIntent && !user) return res.redirect('/auth.html?next=settings.html');
    if (!googleConfigured) return res.redirect(`${failurePage}?error=google_unconfigured`);
    if (intent === 'link' && !(await settingsFor(user, req)).securityVerified) return res.redirect('/settings.html?error=google_verification_required');
    if (intent === 'reauth' && !user.google_sub) return res.redirect('/settings.html?error=google_not_linked');
    await db.prepare('DELETE FROM settings_oauth_states WHERE expires<=?').run(Date.now());
    const state = token();
    const nonce = token();
    // OAuth can return to account settings after a signed-out email confirmation.
    // Only this one local destination and one constrained token parameter are accepted.
    const next = typeof req.query.next === 'string' && /^\/?settings\.html(?:\?emailToken=[a-f0-9]{64})?$/.test(req.query.next)
      ? '/' + req.query.next.replace(/^\//, '') : null;
    await db.prepare('INSERT INTO settings_oauth_states(hash,intent,nonce,user_id,session_hash,expires,next_path) VALUES (?,?,?,?,?,?,?)')
      .run(digest(state), intent, nonce, user?.id || null, settingsIntent ? sessionHash(req) : null, Date.now() + 600000, next);
    res.cookie('ck_oauth', state, { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 600000, path: '/api/google' });
    res.redirect(google.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce,
      ...(settingsIntent ? { prompt: 'select_account' } : {}), ...(intent === 'reauth' ? { max_age: 0 } : {}) }));
  });
  app.get('/api/google/callback', oauthLimit, async (req, res) => {
    const state = req.query.state;
    res.clearCookie('ck_oauth', { path: '/api/google' });
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || state !== getCookie(req, 'ck_oauth')) return res.redirect('/auth.html?error=google_failed');
    const flow = await consumeOAuthState(state);
    const fail = reason => res.redirect(`${flow && flow.intent !== 'login' ? '/settings.html' : '/auth.html'}?error=${reason || 'google_failed'}`);
    if (!flow || typeof req.query.code !== 'string') return fail();
    const boundUser = flow.intent !== 'login' ? await currentUser(req) : null;
    if (flow.intent !== 'login' && (!boundUser || boundUser.id !== flow.user_id || sessionHash(req) !== flow.session_hash)) return fail();
    try {
      const { tokens } = await google.getToken(req.query.code);
      const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      if (!profile || !profile.email_verified || !validEmail(profile.email) || typeof profile.sub !== 'string' ||
          !profile.sub || profile.nonce !== flow.nonce) throw new Error('Google identity could not be verified.');
      if (flow.intent !== 'login') {
        const current = await currentUser(req);
        if (!current || current.id !== boundUser.id || current.google_sub !== boundUser.google_sub || current.password !== boundUser.password) return fail();
        if (flow.intent === 'reauth') {
          if (current.google_sub !== profile.sub) return fail('google_wrong_account');
          // max_age=0 asks Google to authenticate for this request; verify auth_time
          // when supplied, while still requiring the signed nonce on every flow.
          if (profile.auth_time && profile.auth_time * 1000 < Date.now() - REAUTH_LIFETIME) return fail();
        } else {
          const linked = await db.prepare('SELECT id FROM users WHERE google_sub=?').get(profile.sub);
          if (linked && linked.id !== current.id) return fail('google_account_in_use');
          if (current.google_sub && current.google_sub !== profile.sub) return fail('google_already_linked');
        }
        await db.exec('BEGIN IMMEDIATE');
        try {
          if (!await lockSensitiveUser(req, current)) {
            await db.exec('ROLLBACK');
            return fail();
          }
          if (flow.intent === 'link') await db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(profile.sub, current.id);
          const verifiedSessionHash = await rotateSession(res, req, await freshUser(current));
          await db.prepare('INSERT INTO settings_session_verifications(session_hash,verified_at) VALUES (?,?)')
            .run(verifiedSessionHash, Date.now());
          await db.exec('COMMIT');
        } catch (error) {
          await db.exec('ROLLBACK');
          if (error.code === 'ER_DUP_ENTRY' && flow.intent === 'link') return fail('google_account_in_use');
          throw error;
        }
        return res.redirect(`/settings.html?google=${flow.intent === 'link' ? 'linked' : 'verified'}`);
      }
      let user = await db.prepare('SELECT * FROM users WHERE google_sub=?').get(profile.sub);
      if (!user) {
        if (await db.prepare('SELECT id FROM users WHERE email=?').get(normalizeEmail(profile.email))) return fail();
        const result = await db.prepare('INSERT INTO users(email,name,verified,google_sub,created_at) VALUES (?,?,1,?,?)')
          .run(normalizeEmail(profile.email), String(profile.name || profile.email).slice(0, 100), profile.sub, Date.now());
        user = await db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
      }
      if (!user.verified) return fail();
      await startSession(res, user, req);
      if (flow.next_path) return res.redirect(flow.next_path);
      const selected = await db.prepare('SELECT career_id FROM selected_career WHERE user_id=?').get(user.id);
      res.redirect(selected ? '/dashboard.html' : '/onboarding.html');
    } catch { fail(); }
  });
}

module.exports = { installAccountSettings, preferencesFor };
