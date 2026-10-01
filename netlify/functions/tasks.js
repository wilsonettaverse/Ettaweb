// CRUD for independent tasks (environment art, misc jobs not tied to a clan).
// Mirrors characters.js exactly — same permission model, same shape — just a
// separate blob key so tasks never show up mixed into the clan roster.
const { connectLambda, getTasks, setTasks, requireSession, json, uid } = require('./_lib');

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
    if (!body.createdAt) body.createdAt = Date.now();
    body.updatedAt = Date.now();
    const tasks = await getTasks();
    const i = tasks.findIndex(function (t) { return t.id === body.id; });
    if (i >= 0) tasks[i] = body;
    else tasks.push(body);
    await setTasks(tasks);
    return json(200, body);
  }

  if (event.httpMethod === 'DELETE') {
    const session = await requireSession(event);
    if (!session || session.role !== 'Admin') return json(401, { error: 'Admin sign-in required' });
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { error: 'Missing id' });
    const tasks = await getTasks();
    await setTasks(tasks.filter(function (t) { return t.id !== id; }));
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
