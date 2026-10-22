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
  const avatarDirectory = path.resolve(options.avatarUploadDir || path.join(dataDir, 'avatars'));
  mkdirSync(avatarDirectory, { recursive: true });
  const googleConfigured = Boolean(options.googleClient || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET));
  const google = options.googleClient || new OAuth2Client(process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET, `${base}/api/google/callback`);
  const sessionHash = req => digest(getCookie(req, 'ck_session'));
  const savedSettings = id => db.prepare('SELECT * FROM account_settings WHERE user_id=?').get(id);
  const settingsFor = (user, req, activeSessionHash = sessionHash(req)) => {
    const settings = savedSettings(user.id);
    const character = characterImages.has(settings?.avatar_character) ? settings.avatar_character : null;
    const profile = db.prepare('SELECT display_name FROM profiles WHERE user_id=?').get(user.id);
    const verified = db.prepare('SELECT verified_at FROM settings_session_verifications WHERE session_hash=?').get(activeSessionHash);
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
  const reply = (res, user, req, extra = {}, activeSessionHash) => res.json({ success: true, settings: settingsFor(user, req, activeSessionHash), ...extra });
  const freshUser = user => db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  const avatarPath = key => /^[a-f0-9]{64}$/.test(key || '') ? path.join(avatarDirectory, key) : null;
  function removeAvatar(key) {
    const filename = avatarPath(key);
    if (!filename) return;
    try { unlinkSync(filename); }
    catch (error) { if (error.code !== 'ENOENT') console.error('Could not remove an account photo.'); }
  }
  function writeSettings(userId, values) {
    const previous = savedSettings(userId) || {};
    const updated = { theme: previous.theme || null, reduced_motion: previous.reduced_motion || 0,
      preferences_saved: previous.preferences_saved || 0,
      dashboard_tour_seen: previous.dashboard_tour_seen || 0,
      dyslexia_font: previous.dyslexia_font || 0, font_size: previous.font_size || 'default',
      contrast: previous.contrast || 'default', saturation: previous.saturation || 'default',
      cursor_size: previous.cursor_size || 'default',
      avatar_key: previous.avatar_key || null, avatar_version: previous.avatar_version || null,
      avatar_character: previous.avatar_character || null, ...values };
    db.prepare(`INSERT INTO account_settings(user_id,theme,reduced_motion,preferences_saved,dashboard_tour_seen,dyslexia_font,font_size,contrast,saturation,cursor_size,avatar_key,avatar_version,avatar_character,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,
      preferences_saved=excluded.preferences_saved,
      dashboard_tour_seen=excluded.dashboard_tour_seen,
      dyslexia_font=excluded.dyslexia_font, font_size=excluded.font_size, contrast=excluded.contrast,
      saturation=excluded.saturation, cursor_size=excluded.cursor_size,
      reduced_motion=excluded.reduced_motion, avatar_key=excluded.avatar_key,
      avatar_version=excluded.avatar_version, avatar_character=excluded.avatar_character,
      updated_at=excluded.updated_at`).run(userId, updated.theme, updated.reduced_motion,
      updated.preferences_saved, updated.dashboard_tour_seen,
      updated.dyslexia_font, updated.font_size, updated.contrast, updated.saturation, updated.cursor_size,
      updated.avatar_key, updated.avatar_version, updated.avatar_character, Date.now());
  }
  async function sensitiveUser(req, res) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (user.password) {
      const password = req.body.currentPassword;
      if (typeof password !== 'string' || password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
        res.status(401).json({ error: 'Enter your current password.', code: 'incorrect_password' }); return null;
      }
      if (!(await verifyPassword(password, user.password)).valid) {
        res.status(401).json({ error: 'Your current password is incorrect.', code: 'incorrect_password' }); return null;
      }
    } else if (!user.google_sub || !settingsFor(user, req).securityVerified) {
      res.status(403).json({ error: 'Verify your identity with Google before making this change.', code: 'reauth_required' }); return null;
    }
    // Password hashing yields to other requests: recheck session and credentials.
    const current = currentUser(req);
    if (!current || current.id !== user.id || current.password !== user.password || current.google_sub !== user.google_sub) {
      res.status(401).json({ error: 'Your account changed. Sign in and try again.' }); return null;
    }
    return current;
  }
  const securityLimit = rateLimit({ windowMs: 15 * 60000, limit: 20,
    message: { error: 'Too many security requests. Try again later.' }, standardHeaders: 'draft-8', legacyHeaders: false });
  app.get('/api/settings', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.json({ settings: settingsFor(user, req), stats: {
      completedActivities: db.prepare("SELECT COUNT(*) AS count FROM roadmap_progress WHERE user_id=? AND status='completed'").get(user.id).count,
      verifiedSkills: db.prepare('SELECT COUNT(*) AS count FROM user_skills WHERE user_id=?').get(user.id).count
    } });
  });
  app.post('/api/settings/dashboard-tour', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        !['completed', 'skipped'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Choose a valid dashboard tour status.' });
    }
    writeSettings(user.id, { dashboard_tour_seen: 1 });
    res.json({ success: true, dashboardTourSeen: true });
  });
  app.post('/api/settings/profile', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const name = req.body.displayName;
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      return res.status(400).json({ error: 'Enter a display name of 1–100 characters.' });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET name=? WHERE id=?').run(name.trim(), user.id);
      db.prepare(`INSERT INTO profiles(user_id,display_name,updated_at) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`).run(user.id, name.trim(), Date.now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    reply(res, freshUser(user), req);
  });
  app.post('/api/settings/preferences', (req, res) => {
    const user = requireUser(req, res);
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
    writeSettings(user.id, { ...values, preferences_saved: 1 });
    reply(res, user, req);
  });
  const avatarUpload = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: AVATAR_LIMIT, files: 1, fields: 0, parts: 1
  } }).single('avatar');
  app.post('/api/settings/avatar', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    avatarUpload(req, res, async error => {
      if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Choose one PNG, JPG or WebP image, up to 2 MB.' });
      if (!req.file) return res.status(400).json({ error: 'Choose a profile picture.' });
      let bytes;
      try { bytes = await normalizeAvatar(req.file); }
      catch { return res.status(400).json({ error: 'Choose a valid PNG, JPG or WebP image up to 2 MB and 16 megapixels.' }); }
      if (!currentUser(req) || !freshUser(user)) return res.status(401).json({ error: 'Sign in to update your picture.' });
      const previous = savedSettings(user.id);
      const key = token();
      try {
        writeFileSync(avatarPath(key), bytes, { flag: 'wx', mode: 0o600 });
        writeSettings(user.id, { avatar_key: key, avatar_version: token().slice(0, 16), avatar_character: null });
      } catch {
        removeAvatar(key);
        return res.status(503).json({ error: 'Your profile picture could not be saved. Try again.' });
      }
      removeAvatar(previous?.avatar_key);
      reply(res, freshUser(user), req);
    });
  });
  app.get('/api/settings/avatar', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const settings = savedSettings(user.id);
    const filename = characterImages.get(settings?.avatar_character) || avatarPath(settings?.avatar_key);
    if (!filename) return res.status(404).json({ error: 'No profile picture has been uploaded.' });
    res.type('png').sendFile(filename, error => {
      if (error && !res.headersSent) res.status(404).json({ error: 'Profile picture is unavailable.' });
    });
  });
  app.post('/api/settings/avatar/character', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const characterId = req.body.characterId;
    if (typeof characterId !== 'string' || !characterImages.has(characterId)) {
      return res.status(400).json({ error: 'Choose a character from the avatar collection.' });
    }
    const previous = savedSettings(user.id)?.avatar_key;
    writeSettings(user.id, { avatar_character: characterId, avatar_key: null, avatar_version: token().slice(0, 16) });
    removeAvatar(previous);
    reply(res, user, req);
  });
  app.post('/api/settings/avatar/remove', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const old = savedSettings(user.id)?.avatar_key;
    writeSettings(user.id, { avatar_key: null, avatar_version: null, avatar_character: null });
    removeAvatar(old);
    reply(res, user, req);
  });
  app.post('/api/settings/password', securityLimit, async (req, res) => {
    const password = req.body.newPassword;
    if (!validateNewPassword(password)) return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    const user = await sensitiveUser(req, res);
    if (!user) return;
    const hash = await hashPassword(password);
    const current = currentUser(req);
    if (!current || current.id !== user.id || current.password !== user.password || current.google_sub !== user.google_sub) {
      return res.status(401).json({ error: 'Sign in and try again.' });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
      db.prepare('DELETE FROM tokens WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM settings_email_changes WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM settings_session_verifications WHERE session_hash IN (SELECT hash FROM sessions WHERE user_id=?)').run(user.id);
      db.prepare('DELETE FROM settings_oauth_states WHERE user_id=?').run(user.id);
      rotateSession(res, req, freshUser(user), { revokeOthers: true });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    reply(res, freshUser(user), req);
  });
  app.post('/api/settings/email', securityLimit, emailLimit, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const user = await sensitiveUser(req, res);
    if (!user) return;
    if (email === user.email) return res.status(400).json({ error: 'Enter a different email address.' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'This email address is already in use.' });
    const value = token();
    db.prepare(`INSERT INTO settings_email_changes(user_id,hash,old_email,new_email,expires) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash,old_email=excluded.old_email,
      new_email=excluded.new_email,expires=excluded.expires`).run(user.id, digest(value), user.email, email, Date.now() + 3600000);
    try {
      await send({ to: email, subject: 'Confirm your new CareerKraft email',
        text: `Hello ${user.name},\n\nConfirm your new email address using this link:\n${base}/settings.html?emailToken=${value}\n\nSign in to the CareerKraft account that requested this change. This link expires in 60 minutes and can be used once. If you did not request this change, ignore this email.` });
    } catch {
      db.prepare('DELETE FROM settings_email_changes WHERE hash=?').run(digest(value));
      return res.status(503).json({ error: 'The confirmation email could not be sent. Your email address has not changed.' });
    }
    // The account may have been deleted while delivery was pending.
    const current = currentUser(req);
    if (!current) return res.status(401).json({ error: 'Sign in to continue.' });
    reply(res, current, req, { pendingEmail: email, message: 'Check your new email address for a confirmation link.' });
  });
  app.post('/api/settings/email/confirm', securityLimit, (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const value = req.body.token;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
    const pending = db.prepare('SELECT * FROM settings_email_changes WHERE user_id=? AND hash=? AND expires>? AND old_email=?')
      .get(user.id, digest(value), Date.now(), user.email);
    if (!pending) return res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
    if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(pending.new_email, user.id)) return res.status(409).json({ error: 'This email address is already in use.' });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET email=? WHERE id=?').run(pending.new_email, user.id);
      if (db.prepare('SELECT id FROM early_access WHERE email=?').get(pending.new_email)) db.prepare('DELETE FROM early_access WHERE email=?').run(user.email);
      else db.prepare('UPDATE early_access SET email=? WHERE email=?').run(pending.new_email, user.email);
      db.prepare('DELETE FROM settings_email_changes WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM tokens WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM settings_session_verifications WHERE session_hash IN (SELECT hash FROM sessions WHERE user_id=?)').run(user.id);
      db.prepare('DELETE FROM settings_oauth_states WHERE user_id=?').run(user.id);
      rotateSession(res, req, freshUser(user), { revokeOthers: true });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    reply(res, freshUser(user), req);
  });
  app.post('/api/settings/sessions/revoke', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(user.id, sessionHash(req));
    reply(res, user, req);
  });
  app.post('/api/settings/google/link', securityLimit, async (req, res) => {
    const user = await sensitiveUser(req, res);
    if (!user) return;
    if (!googleConfigured) return res.status(503).json({ error: 'Google sign-in has not been configured.', code: 'google_unconfigured' });
    let verifiedSessionHash;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Elevation belongs only to the freshly issued cookie. A copied pre-proof
      // session must not gain authority when its legitimate owner verifies.
      verifiedSessionHash = rotateSession(res, req, user);
      db.prepare('INSERT INTO settings_session_verifications(session_hash,verified_at) VALUES (?,?)')
        .run(verifiedSessionHash, Date.now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    reply(res, user, req, { url: '/api/google?intent=link' }, verifiedSessionHash);
  });
  app.post('/api/settings/google/unlink', securityLimit, async (req, res) => {
    const user = await sensitiveUser(req, res);
    if (!user) return;
    if (!user.password) return res.status(400).json({ error: 'Set a password before disconnecting your only sign-in method.', code: 'password_required' });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET google_sub=NULL WHERE id=?').run(user.id);
      db.prepare('DELETE FROM settings_session_verifications WHERE session_hash IN (SELECT hash FROM sessions WHERE user_id=?)').run(user.id);
      db.prepare('DELETE FROM settings_oauth_states WHERE user_id=?').run(user.id);
      rotateSession(res, req, freshUser(user), { revokeOthers: true });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    reply(res, freshUser(user), req);
  });
  app.get('/api/settings/export', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const owned = table => db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).all(user.id);
    const roadmaps = owned('roadmaps');
    const steps = db.prepare('SELECT roadmap_steps.* FROM roadmap_steps JOIN roadmaps ON roadmaps.id=roadmap_steps.roadmap_id WHERE roadmaps.user_id=?').all(user.id);
    const content = db.prepare(`SELECT roadmap_step_content.* FROM roadmap_step_content
      JOIN roadmap_steps ON roadmap_steps.id=roadmap_step_content.roadmap_step_id
      JOIN roadmaps ON roadmaps.id=roadmap_steps.roadmap_id WHERE roadmaps.user_id=?`).all(user.id);
    const notifications = db.prepare('SELECT roadmap_level_notifications.* FROM roadmap_level_notifications JOIN roadmaps ON roadmaps.id=roadmap_level_notifications.roadmap_id WHERE roadmaps.user_id=?').all(user.id);
    const evidence = owned('evidence_submissions').map(({ file_storage_key, ...submission }) => submission);
    res.attachment('careerkraft-account.json').json({ exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email, displayName: settingsFor(user, req).displayName,
        createdAt: user.created_at, emailVerified: Boolean(user.verified), googleLinked: Boolean(user.google_sub),
        avatarCharacter: settingsFor(user, req).avatarCharacter },
      preferences: preferencesFor(savedSettings(user.id)),
      uiPreferences: { dashboardTourSeen: Boolean(savedSettings(user.id)?.dashboard_tour_seen) },
      profile: owned('profiles')[0] || null, assessments: owned('career_assessments'), careerMatches: owned('career_matches'),
      selectedCareer: owned('selected_career')[0] || null, roadmaps, steps, moduleContent: content,
      progress: owned('roadmap_progress'), levelNotifications: notifications, evidence,
      skills: owned('user_skills'), skillVerifications: owned('skill_verifications'),
      lumia: { conversations: owned('lumia_conversations'), messages: owned('lumia_messages') }
    });
  });
  app.post('/api/settings/delete', securityLimit, async (req, res) => {
    if (req.body.confirmation !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm account deletion.' });
    const user = await sensitiveUser(req, res);
    if (!user) return;
    const evidenceKeys = db.prepare('SELECT file_storage_key FROM evidence_submissions WHERE user_id=?').all(user.id);
    const avatar = savedSettings(user.id)?.avatar_key;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Legacy token/session foreign keys do not cascade.
      db.prepare('DELETE FROM tokens WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM early_access WHERE email=?').run(user.email);
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    for (const row of evidenceKeys) {
      // Never remove another account's attachment if old database data reused a key.
      if (!db.prepare('SELECT id FROM evidence_submissions WHERE file_storage_key=?').get(row.file_storage_key)) removeEvidenceFile(row.file_storage_key);
    }
    removeAvatar(avatar);
    clearSessionCookie(res);
    res.json({ success: true });
  });
  app.get('/api/google', oauthLimit, (req, res) => {
    const intent = req.query.intent || 'login';
    if (!['login', 'link', 'reauth'].includes(intent)) return res.redirect('/settings.html?error=google_failed');
    const settingsIntent = intent !== 'login';
    const failurePage = settingsIntent ? '/settings.html' : '/auth.html';
    const user = settingsIntent ? currentUser(req) : null;
    if (settingsIntent && !user) return res.redirect('/auth.html?next=settings.html');
    if (!googleConfigured) return res.redirect(`${failurePage}?error=google_unconfigured`);
    if (intent === 'link' && !settingsFor(user, req).securityVerified) return res.redirect('/settings.html?error=google_verification_required');
    if (intent === 'reauth' && !user.google_sub) return res.redirect('/settings.html?error=google_not_linked');
    db.prepare('DELETE FROM settings_oauth_states WHERE expires<=?').run(Date.now());
    const state = token();
    const nonce = token();
    // OAuth can return to account settings after a signed-out email confirmation.
    // Only this one local destination and one constrained token parameter are accepted.
    const next = typeof req.query.next === 'string' && /^\/?settings\.html(?:\?emailToken=[a-f0-9]{64})?$/.test(req.query.next)
      ? '/' + req.query.next.replace(/^\//, '') : null;
    db.prepare('INSERT INTO settings_oauth_states(hash,intent,nonce,user_id,session_hash,expires,next_path) VALUES (?,?,?,?,?,?,?)')
      .run(digest(state), intent, nonce, user?.id || null, settingsIntent ? sessionHash(req) : null, Date.now() + 600000, next);
    res.cookie('ck_oauth', state, { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 600000, path: '/api/google' });
    res.redirect(google.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce,
      ...(settingsIntent ? { prompt: 'select_account' } : {}), ...(intent === 'reauth' ? { max_age: 0 } : {}) }));
  });
  app.get('/api/google/callback', oauthLimit, async (req, res) => {
    const state = req.query.state;
    res.clearCookie('ck_oauth', { path: '/api/google' });
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || state !== getCookie(req, 'ck_oauth')) return res.redirect('/auth.html?error=google_failed');
    const flow = db.prepare('DELETE FROM settings_oauth_states WHERE hash=? AND expires>? RETURNING *').get(digest(state), Date.now());
    const fail = reason => res.redirect(`${flow && flow.intent !== 'login' ? '/settings.html' : '/auth.html'}?error=${reason || 'google_failed'}`);
    if (!flow || typeof req.query.code !== 'string') return fail();
    const boundUser = flow.intent !== 'login' ? currentUser(req) : null;
    if (flow.intent !== 'login' && (!boundUser || boundUser.id !== flow.user_id || sessionHash(req) !== flow.session_hash)) return fail();
    try {
      const { tokens } = await google.getToken(req.query.code);
      const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      if (!profile || !profile.email_verified || !validEmail(profile.email) || typeof profile.sub !== 'string' ||
          !profile.sub || profile.nonce !== flow.nonce) throw new Error('Google identity could not be verified.');
      if (flow.intent !== 'login') {
        const current = currentUser(req);
        if (!current || current.id !== boundUser.id || current.google_sub !== boundUser.google_sub || current.password !== boundUser.password) return fail();
        if (flow.intent === 'reauth') {
          if (current.google_sub !== profile.sub) return fail('google_wrong_account');
          // max_age=0 asks Google to authenticate for this request; verify auth_time
          // when supplied, while still requiring the signed nonce on every flow.
          if (profile.auth_time && profile.auth_time * 1000 < Date.now() - REAUTH_LIFETIME) return fail();
        } else {
          const linked = db.prepare('SELECT id FROM users WHERE google_sub=?').get(profile.sub);
          if (linked && linked.id !== current.id) return fail('google_account_in_use');
          if (current.google_sub && current.google_sub !== profile.sub) return fail('google_already_linked');
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          if (flow.intent === 'link') db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(profile.sub, current.id);
          const verifiedSessionHash = rotateSession(res, req, freshUser(current));
          db.prepare('INSERT INTO settings_session_verifications(session_hash,verified_at) VALUES (?,?)')
            .run(verifiedSessionHash, Date.now());
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return res.redirect(`/settings.html?google=${flow.intent === 'link' ? 'linked' : 'verified'}`);
      }
      let user = db.prepare('SELECT * FROM users WHERE google_sub=?').get(profile.sub);
      if (!user) {
        if (db.prepare('SELECT id FROM users WHERE email=?').get(normalizeEmail(profile.email))) return fail();
        const result = db.prepare('INSERT INTO users(email,name,verified,google_sub,created_at) VALUES (?,?,1,?,?)')
          .run(normalizeEmail(profile.email), String(profile.name || profile.email).slice(0, 100), profile.sub, Date.now());
        user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
      }
      if (!user.verified) return fail();
      startSession(res, user, req);
      if (flow.next_path) return res.redirect(flow.next_path);
      const selected = db.prepare('SELECT career_id FROM selected_career WHERE user_id=?').get(user.id);
      res.redirect(selected ? '/dashboard.html' : '/onboarding.html');
    } catch { fail(); }
  });
}

module.exports = { installAccountSettings, preferencesFor };
