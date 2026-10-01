const { connectLambda, setSettingRaw, requireSession, json } = require('./_lib');

// 'auth' (the admin password hash) can only be changed via the dedicated
// auth/set-password endpoint, never through this generic settings write.
// 'resetCode' (the salted hash of an in-flight recovery code) is likewise
// only ever written by the auth-forgot-password / auth-reset-password pair.
const BLOCKED_KEYS = ['auth', 'resetCode'];

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const session = await requireSession(event);
  if (!session || session.role !== 'Admin') return json(401, { error: 'Admin sign-in required' });
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }
  const key = body.key;
  if (!key || BLOCKED_KEYS.indexOf(key) >= 0) return json(400, { error: 'Invalid key' });
  await setSettingRaw(key, body.value);
  return json(200, { ok: true });
};
