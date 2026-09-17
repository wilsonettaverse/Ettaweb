const { connectLambda, getSettingRaw, setSettingRaw, requireSession, sha256Hex, randSalt, signToken, json, ADMIN_NAME, TOKEN_TTL_MS } = require('./_lib');

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }
  const newPassword = body.newPassword || '';
  if (newPassword.length < 4) return json(400, { error: 'Password too short' });

  const auth = await getSettingRaw('auth');
  const session = await requireSession(event);
  const isAdminSession = !!(session && session.role === 'Admin' && session.name === ADMIN_NAME);

  if (!auth || !auth.hash) {
    // First-run bootstrap: no admin password exists yet on this deployment.
    const salt = randSalt();
    const hash = sha256Hex(salt + '|' + newPassword);
    await setSettingRaw('auth', { salt: salt, hash: hash });
    const token = await signToken({ name: ADMIN_NAME, role: 'Admin', exp: Date.now() + TOKEN_TTL_MS });
    return json(200, { token: token });
  }

  if (!isAdminSession) {
    const oldPassword = body.oldPassword || '';
    const oldHash = sha256Hex(auth.salt + '|' + oldPassword);
    if (oldHash !== auth.hash) return json(401, { error: 'Current password is incorrect' });
  }

  const salt = randSalt();
  const hash = sha256Hex(salt + '|' + newPassword);
  await setSettingRaw('auth', { salt: salt, hash: hash });
  const token = await signToken({ name: ADMIN_NAME, role: 'Admin', exp: Date.now() + TOKEN_TTL_MS });
  return json(200, { token: token });
};
