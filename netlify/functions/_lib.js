// Shared helpers for all Character Codex backend functions.
// Storage: Netlify Blobs (auto-provisioned, no external account needed).
// Auth: HMAC-signed bearer tokens, secret auto-generated on first use and
// persisted in the blob store (or overridden via SESSION_SECRET env var).

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const ADMIN_NAME = 'Wilson';
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

// Note: 'strong' consistency requires an edge URL this classic (Lambda-
// compatibility) function runtime doesn't always get from Netlify, which
// throws "not configured with a 'uncachedEdgeURL' property". Default
// (eventual) consistency avoids that; for a small internal tool the brief
// read-after-write propagation delay (seconds, not the old per-browser
// storage) is an acceptable trade-off.
function dataStore() {
  return getStore({ name: 'codex-data' });
}
function imageStore() {
  return getStore({ name: 'codex-images' });
}

async function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const store = dataStore();
  let secret = await store.get('secret:session', { type: 'text' });
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    // onlyIfNew avoids a race where two cold-start invocations both mint a secret.
    const res = await store.set('secret:session', secret, { onlyIfNew: true });
    if (res && res.modified === false) {
      secret = await store.get('secret:session', { type: 'text' });
    }
  }
  return secret;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

async function signToken(payload) {
  const secret = await getSecret();
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + sig;
}

async function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const secret = await getSecret();
  const expected = b64url(crypto.createHmac('sha256', secret).update(parts[0]).digest());
  if (expected.length !== parts[1].length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[1]))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getBearer(event) {
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : '';
}

async function requireSession(event) {
  const token = getBearer(event);
  return await verifyToken(token); // {name, role, exp} or null
}

function json(status, body, extraHeaders) {
  return {
    statusCode: status,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function randSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function uid() {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function getCharacters() {
  const arr = await dataStore().get('characters', { type: 'json' });
  return Array.isArray(arr) ? arr : [];
}
async function setCharacters(arr) {
  await dataStore().setJSON('characters', arr);
}

// Safely applies a change to a list stored as one JSON blob (characters,
// tasks, images-meta — each one record per character/task/image, all under
// a single key). A plain read-modify-write (read the list, change one
// record, write the whole list back) is only safe if saves never overlap —
// but once most actions save in the background right after a click, two
// saves for the same key routinely land close together (even for two
// different characters, or two unrelated fields), and Blobs has no
// multi-key transaction to keep that safe on its own. Whichever write
// landed last would otherwise win outright, using a list it read *before*
// the other save happened — silently erasing that other save, with no
// error on either side. That's the "assign a sprint and it quietly reverts"
// class of bug.
//
// This closes that gap with optimistic concurrency: read the list along
// with its current ETag, hand it to `mutate(list)` to produce the list to
// write, and write back only `onlyIfMatch` that exact ETag (or `onlyIfNew`
// when the key doesn't exist yet). If another save slipped in between our
// read and our write, the ETag won't match, the write comes back
// `modified:false`, and we re-read the now-current list and try again —
// so our change still lands, on top of the other save rather than
// clobbering it. `mutate` may run more than once (once per retry), so it
// must be a pure function of the list it's given — no side effects beyond
// returning the next list. Returning `null` from `mutate` means "nothing to
// write after all" (e.g. the record to update wasn't found) and skips the
// write entirely, returning `null`.
async function updateList(key, mutate) {
  const store = dataStore();
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await store.getWithMetadata(key, { type: 'json' });
    const list = Array.isArray(current && current.data) ? current.data : [];
    const next = mutate(list);
    if (next === null) return null;
    const opts = (current && current.etag) ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await store.setJSON(key, next, opts);
    if (result.modified) return next;
    // Someone else wrote to this key between our read and our write attempt
    // — re-read the now-current list and re-apply `mutate` to it.
  }
  throw new Error('Could not save — too many people editing this at once, please try again');
}
// Tasks are small jobs (environment art, misc one-offs) that aren't tied to
// any clan. They live in their own blob key, share the images store with
// characters (image ids are globally unique), and share the same status/
// review/history shape so the rest of the app's helpers work on them as-is.
async function getTasks() {
  const arr = await dataStore().get('tasks', { type: 'json' });
  return Array.isArray(arr) ? arr : [];
}
async function setTasks(arr) {
  await dataStore().setJSON('tasks', arr);
}
async function getImagesMeta() {
  const arr = await dataStore().get('images', { type: 'json' });
  return Array.isArray(arr) ? arr : [];
}
async function setImagesMeta(arr) {
  await dataStore().setJSON('images', arr);
}
async function getSettingRaw(key) {
  return await dataStore().get('setting:' + key, { type: 'json' });
}
async function setSettingRaw(key, value) {
  await dataStore().setJSON('setting:' + key, value);
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { contentType: m[1], bytes: Buffer.from(m[2], 'base64') };
}

// 6-digit numeric code for the admin password-recovery flow.
function genCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Sends a transactional email via Resend (https://resend.com). Requires the
// RESEND_API_KEY environment variable (set in Netlify's env vars — never
// committed to source). Throws if unset or if the API call fails, so callers
// should catch rather than let a misconfigured key break the whole request.
async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Character Codex <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(function () { return ''; });
    throw new Error('Resend error ' + res.status + ': ' + text);
  }
  return res.json();
}

module.exports = {
  ADMIN_NAME,
  TOKEN_TTL_MS,
  dataStore,
  imageStore,
  signToken,
  verifyToken,
  requireSession,
  json,
  sha256Hex,
  randSalt,
  uid,
  getCharacters,
  setCharacters,
  updateList,
  getTasks,
  setTasks,
  getImagesMeta,
  setImagesMeta,
  getSettingRaw,
  setSettingRaw,
  parseDataUrl,
  genCode,
  sendEmail,
  connectLambda: require('@netlify/blobs').connectLambda
};
