// Completes an admin password-recovery flow started by auth-forgot-password:
// verifies the emailed 6-digit code, sets a new admin password, and issues a
// fresh Admin session token so the reset acts as a sign-in too.
const { connectLambda, getSettingRaw, setSettingRaw, sha256Hex, randSalt, signToken, json, ADMIN_NAME, TOKEN_TTL_MS } = require('./_lib');

const MAX_ATTEMPTS = 6;

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }
  const code = (body.code || '').trim();
  const newPassword = body.newPassword || '';
  if (!code) return json(400, { error: 'Missing code' });
  if (newPassword.length < 4) return json(400, { error: 'Password too short' });

  const rc = await getSettingRaw('resetCode');
  if (!rc || !rc.hash) return json(400, { error: 'No reset code was requested' });
  if (Date.now() > rc.expires) {
    await setSettingRaw('resetCode', null);
    return json(400, { error: 'That code expired — request a new one' });
  }
  if ((rc.attempts || 0) >= MAX_ATTEMPTS) {
    await setSettingRaw('resetCode', null);
    return json(429, { error: 'Too many attempts — request a new code' });
  }

  const hash = sha256Hex(rc.salt + '|' + code);
  if (hash !== rc.hash) {
    await setSettingRaw('resetCode', Object.assign({}, rc, { attempts: (rc.attempts || 0) + 1 }));
    return json(401, { error: 'Incorrect code' });
  }

  const salt = randSalt();
  const newHash = sha256Hex(salt + '|' + newPassword);
  await setSettingRaw('auth', { salt: salt, hash: newHash });
  await setSettingRaw('resetCode', null);
  const token = await signToken({ name: ADMIN_NAME, role: 'Admin', exp: Date.now() + TOKEN_TTL_MS });
  return json(200, { token: token });
};
