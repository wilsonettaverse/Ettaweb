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
  getImagesMeta,
  setImagesMeta,
  getSettingRaw,
  setSettingRaw,
  parseDataUrl,
  connectLambda: require('@netlify/blobs').connectLambda
};
