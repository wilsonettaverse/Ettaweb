const { connectLambda, getSettingRaw, signToken, sha256Hex, json, ADMIN_NAME, TOKEN_TTL_MS } = require('./_lib');

function delay(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }
  const name = (body.name || '').trim();
  const password = body.password || '';
  if (!name) return json(400, { error: 'Missing name' });

  if (name === ADMIN_NAME) {
    const auth = await getSettingRaw('auth');
    if (!auth || !auth.hash) return json(409, { error: 'No admin password set yet' });
    const hash = sha256Hex(auth.salt + '|' + password);
    if (hash !== auth.hash) {
      await delay(400); // small throttle against brute-force guessing
      return json(401, { error: 'Incorrect password' });
    }
    const token = await signToken({ name: ADMIN_NAME, role: 'Admin', exp: Date.now() + TOKEN_TTL_MS });
    return json(200, { token: token, name: ADMIN_NAME, role: 'Admin' });
  }

  const users = (await getSettingRaw('users')) || [];
  const user = users.find(function (u) { return u.name === name; });
  if (!user) return json(404, { error: 'Unknown user' });
  if (user.hash) {
    const hash = sha256Hex(user.salt + '|' + password);
    if (hash !== user.hash) {
      await delay(400);
      return json(401, { error: 'Incorrect password' });
    }
  }
  const role = user.role || 'Artist';
  const token = await signToken({ name: user.name, role: role, exp: Date.now() + TOKEN_TTL_MS });
  return json(200, { token: token, name: user.name, role: role });
};
