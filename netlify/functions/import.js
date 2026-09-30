// Admin-only: replace the entire shared roster from an uploaded backup JSON.
const { connectLambda, setCharacters, setImagesMeta, getImagesMeta, imageStore, requireSession, json, parseDataUrl } = require('./_lib');

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
  const characters = Array.isArray(body.characters) ? body.characters : [];
  const images = Array.isArray(body.images) ? body.images : [];

  const oldMeta = await getImagesMeta();
  await Promise.all(oldMeta.map(function (m) { return imageStore().delete(m.id).catch(function () {}); }));

  const metaArr = [];
  for (const im of images) {
    const parsed = parseDataUrl(im.data);
    if (!parsed || !im.id) continue;
    await imageStore().set(im.id, parsed.bytes, { metadata: { contentType: parsed.contentType, charId: im.charId, name: im.name || '' } });
    metaArr.push({ id: im.id, charId: im.charId, name: im.name || '', ts: im.ts || Date.now(), by: im.by || null });
  }

  await setCharacters(characters);
  await setImagesMeta(metaArr);
  return json(200, { ok: true, imported: characters.length });
};
