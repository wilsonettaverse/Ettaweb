// Admin-only: wipe the shared roster and re-seed the original defaults.
const { connectLambda, getImagesMeta, setImagesMeta, setCharacters, imageStore, requireSession, json, parseDataUrl } = require('./_lib');

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
  const chars = Array.isArray(body.characters) ? body.characters : [];
  const imagesByChar = body.images || {};

  const oldMeta = await getImagesMeta();
  await Promise.all(oldMeta.map(function (m) { return imageStore().delete(m.id).catch(function () {}); }));

  const metaArr = [];
  for (const c of chars) {
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

  await setCharacters(chars);
  await setImagesMeta(metaArr);
  return json(200, { ok: true, seeded: chars.length });
};
