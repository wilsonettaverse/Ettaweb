// One-time, unauthenticated seeding of default data — but ONLY when the
// shared store is currently empty. Safe for any first visitor to trigger.
const { connectLambda, getCharacters, setCharacters, setImagesMeta, imageStore, json, parseDataUrl } = require('./_lib');

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const existing = await getCharacters();
  if (existing.length) return json(200, { ok: true, skipped: true });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }
  const chars = Array.isArray(body.characters) ? body.characters : [];
  const imagesByChar = body.images || {};
  const metaArr = [];

  for (const c of chars) {
    if (!c.id) continue;
    const imgs = imagesByChar[c.id];
    if (imgs && imgs.length) {
      for (let idx = 0; idx < imgs.length; idx++) {
        const im = imgs[idx];
        const parsed = parseDataUrl(im.data);
        if (!parsed) continue;
        const iid = 'seed_' + c.id + '_' + idx;
        await imageStore().set(iid, parsed.bytes, { metadata: { contentType: parsed.contentType, charId: c.id, name: im.name || '' } });
        metaArr.push({ id: iid, charId: c.id, name: im.name || '', ts: Date.now() + idx });
        if (idx === 0) c.primaryImageId = iid;
      }
    }
    if (!c.status) c.status = { approved: false, modeling: false, rigged: false, stored: false };
    if (c.modeledBy == null) c.modeledBy = '';
    if (c.texturedBy == null) c.texturedBy = '';
    if (c.completed == null) c.completed = false;
    if (c.gender == null) c.gender = '';
    if (c.height == null) c.height = '';
    if (c.review == null) c.review = { status: '', count: 0, redos: 0 };
    c.updatedAt = Date.now();
  }

  // Re-check right before writing to narrow (not fully eliminate) a race
  // between two visitors landing on an empty store at the same time.
  const check = await getCharacters();
  if (check.length) return json(200, { ok: true, skipped: true });

  await setCharacters(chars);
  await setImagesMeta(metaArr);
  return json(200, { ok: true, seeded: chars.length });
};
