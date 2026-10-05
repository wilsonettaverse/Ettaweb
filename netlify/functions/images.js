const { connectLambda, getImagesMeta, setImagesMeta, imageStore, requireSession, json, uid, parseDataUrl } = require('./_lib');

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
    const dataUrl = body.dataUrl || body.data;
    if (!dataUrl || !body.charId) return json(400, { error: 'Missing dataUrl or charId' });
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return json(400, { error: 'Invalid data URL' });
    const id = body.id || uid();
    const ts = body.ts || Date.now();
    const name = body.name || '';
    // 'kind' is an optional free-form tag (e.g. 'weapon') letting the client keep an
    // image out of a character's main gallery while still storing it through the
    // same endpoint/store; it's just carried through, never interpreted here.
    const kind = body.kind || '';
    await imageStore().set(id, parsed.bytes, { metadata: { contentType: parsed.contentType, charId: body.charId, name: name, kind: kind } });
    const metaArr = await getImagesMeta();
    const i = metaArr.findIndex(function (x) { return x.id === id; });
    // 'by' is the authenticated session's own name, never trusted from the request body,
    // so the upload-history attribution can't be spoofed by the client.
    const by = session.name;
    const entry = { id: id, charId: body.charId, name: name, ts: ts, by: by, kind: kind };
    if (i >= 0) metaArr[i] = entry;
    else metaArr.push(entry);
    await setImagesMeta(metaArr);
    return json(200, { id: id, charId: body.charId, name: name, ts: ts, by: by, kind: kind, data: '/api/image?id=' + encodeURIComponent(id) });
  }

  if (event.httpMethod === 'DELETE') {
    const session = await requireSession(event);
    if (!session || session.role === 'Viewer') return json(401, { error: 'Sign in required' });
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { error: 'Missing id' });
    await imageStore().delete(id);
    const metaArr = await getImagesMeta();
    await setImagesMeta(metaArr.filter(function (x) { return x.id !== id; }));
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
