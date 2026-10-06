// Full JSON backup with images embedded as base64 data URLs (self-contained,
// matches the original "Export JSON backup" behaviour).
const { connectLambda, getCharacters, getTasks, getImagesMeta, imageStore, requireSession, json } = require('./_lib');

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const session = await requireSession(event);
  if (!session || session.role === 'Viewer') return json(401, { error: 'Sign in required' });

  const characters = await getCharacters();
  const tasks = await getTasks();
  const metaArr = await getImagesMeta();
  // Reading every image's bytes one at a time here was the real cause behind
  // this endpoint coming back as a bare 502 once the roster grew large
  // enough: a sequential await-in-a-loop over a few hundred images easily
  // runs past Netlify's function execution limit, and the client had no way
  // to tell a timeout apart from an auth failure. Fetching them concurrently
  // keeps this endpoint working for as long as the combined response still
  // fits a single function's size limit — see index.html's buildFullBackup,
  // which both the JSON and Excel exports now use instead of this endpoint,
  // for the real fix (streaming images in individually, with no such cap).
  const images = (await Promise.all(metaArr.map(async (m) => {
    try {
      const result = await imageStore().getWithMetadata(m.id, { type: 'arrayBuffer' });
      if (!result) return null;
      const contentType = (result.metadata && result.metadata.contentType) || 'image/jpeg';
      const b64 = Buffer.from(result.data).toString('base64');
      return { id: m.id, charId: m.charId, name: m.name, ts: m.ts, by: m.by || null, kind: m.kind || '', data: 'data:' + contentType + ';base64,' + b64 };
    } catch (e) {
      return null; // skip unreadable image, keep exporting the rest
    }
  }))).filter(Boolean);
  return json(200, { version: 3, characters: characters, tasks: tasks, images: images });
};
