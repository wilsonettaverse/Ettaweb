const { connectLambda, getCharacters, setCharacters, requireSession, json, uid } = require('./_lib');

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === 'POST') {
    const session = await requireSession(event);
    if (!session || session.role === 'Viewer') return json(401, { error: 'Sign in required' });
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Bad JSON' });
    }
    if (!body || typeof body !== 'object') return json(400, { error: 'Bad payload' });
    if (!body.id) body.id = uid();
    body.updatedAt = Date.now();
    const chars = await getCharacters();
    const i = chars.findIndex(function (c) { return c.id === body.id; });
    if (i >= 0) chars[i] = body;
    else chars.push(body);
    await setCharacters(chars);
    return json(200, body);
  }

  if (event.httpMethod === 'DELETE') {
    const session = await requireSession(event);
    if (!session || session.role !== 'Admin') return json(401, { error: 'Admin sign-in required' });
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { error: 'Missing id' });
    const chars = await getCharacters();
    await setCharacters(chars.filter(function (c) { return c.id !== id; }));
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
