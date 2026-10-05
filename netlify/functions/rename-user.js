// Admin-only: rename a teammate everywhere their name is stored server-side.
//
// Renaming used to be done entirely from the client (characters.js/tasks.js
// accept arbitrary JSON, so the browser could just rewrite modeledBy/
// texturedBy itself and PUT the updated records). That missed two places
// that are NOT writable that way:
//   - image metadata's 'by' field (who uploaded/added an image) is hard-set
//     server-side in images.js to the authenticated session's own name and
//     is never trusted from the client, so there was no way for the browser
//     to ever correct it after a rename — old uploads kept showing the old
//     name in their thumbnail captions forever.
//   - the artistGoals setting is keyed by artist name per sprint; a rename
//     left the admin's custom goal override orphaned under the old name
//     instead of carrying it forward to the new one.
// Doing the whole cascade in one atomic server-side request fixes both.
const {
  connectLambda, requireSession, json,
  getCharacters, setCharacters,
  getTasks, setTasks,
  getImagesMeta, setImagesMeta,
  getSettingRaw, setSettingRaw,
  ADMIN_NAME
} = require('./_lib');

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
  const oldName = String(body.oldName || '').trim();
  const newName = String(body.newName || '').trim();
  if (!oldName || !newName) return json(400, { error: 'Missing oldName or newName' });
  if (newName === oldName) return json(200, { ok: true, changed: 0 });
  if (newName === ADMIN_NAME) return json(400, { error: 'That name is reserved for the admin' });

  const users = (await getSettingRaw('users')) || [];
  if (!Array.isArray(users)) return json(500, { error: 'User list is corrupted' });
  const u = users.find(function (x) { return (typeof x === 'string' ? x : x.name) === oldName; });
  const target = users.find(function (x) { return (typeof x === 'string' ? x : x.name) === newName; });

  if (u) {
    // A true rename: oldName is a real teammate today, so the new name must
    // be free.
    if (target) return json(400, { error: 'That name already exists' });
    if (typeof u === 'string') {
      users[users.indexOf(u)] = newName;
    } else {
      u.name = newName;
    }
  } else {
    // No current teammate is called oldName — the only legitimate reason to
    // call this endpoint with that name is to clean up stray leftover data
    // (assignments an earlier, incomplete rename never reached) by merging
    // it into an EXISTING teammate. Never silently invent a new name on
    // some records just because the caller mistyped oldName.
    if (!target) return json(404, { error: 'No such user' });
  }

  const characters = await getCharacters();
  let charsChanged = 0;
  characters.forEach(function (c) {
    var ch = false;
    if ((c.modeledBy || '') === oldName) { c.modeledBy = newName; ch = true; }
    if ((c.texturedBy || '') === oldName) { c.texturedBy = newName; ch = true; }
    if (ch) {
      c.history = (c.history || []).slice();
      c.history.unshift({ ts: Date.now(), user: session.name || 'Unknown', action: 'assignee renamed: "' + oldName + '" → "' + newName + '"' });
      if (c.history.length > 40) c.history.length = 40;
      charsChanged++;
    }
  });

  const tasks = await getTasks();
  let tasksChanged = 0;
  tasks.forEach(function (t) {
    var ch = false;
    if ((t.modeledBy || '') === oldName) { t.modeledBy = newName; ch = true; }
    if ((t.texturedBy || '') === oldName) { t.texturedBy = newName; ch = true; }
    if (ch) {
      t.history = (t.history || []).slice();
      t.history.unshift({ ts: Date.now(), user: session.name || 'Unknown', action: 'assignee renamed: "' + oldName + '" → "' + newName + '"' });
      if (t.history.length > 40) t.history.length = 40;
      tasksChanged++;
    }
  });

  const imagesMeta = await getImagesMeta();
  let imagesChanged = 0;
  imagesMeta.forEach(function (im) {
    if ((im.by || '') === oldName) { im.by = newName; imagesChanged++; }
  });

  const artistGoals = (await getSettingRaw('artistGoals')) || {};
  if (artistGoals && typeof artistGoals === 'object') {
    Object.keys(artistGoals).forEach(function (sprintKey) {
      var row = artistGoals[sprintKey];
      if (row && Object.prototype.hasOwnProperty.call(row, oldName)) {
        // Don't clobber a goal the admin may have already set for newName.
        if (!Object.prototype.hasOwnProperty.call(row, newName)) row[newName] = row[oldName];
        delete row[oldName];
      }
    });
  }

  await Promise.all([
    setSettingRaw('users', users),
    setCharacters(characters),
    setTasks(tasks),
    setImagesMeta(imagesMeta),
    setSettingRaw('artistGoals', artistGoals)
  ]);

  return json(200, {
    ok: true,
    charactersChanged: charsChanged,
    tasksChanged: tasksChanged,
    imagesChanged: imagesChanged
  });
};
