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
  const images = [];
  for (const m of metaArr) {
    try {
      const result = await imageStore().getWithMetadata(m.id, { type: 'arrayBuffer' });
      if (!result) continue;
      const contentType = (result.metadata && result.metadata.contentType) || 'image/jpeg';
      const b64 = Buffer.from(result.data).toString('base64');
      images.push({ id: m.id, charId: m.charId, name: m.name, ts: m.ts, by: m.by || null, data: 'data:' + contentType + ';base64,' + b64 });
    } catch (e) {
      // skip unreadable image, keep exporting the rest
    }
  }
  return json(200, { version: 3, characters: characters, tasks: tasks, images: images });
};
