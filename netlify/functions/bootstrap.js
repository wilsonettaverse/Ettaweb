const { connectLambda, getCharacters, getImagesMeta, getSettingRaw, json } = require('./_lib');

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const [characters, imagesMeta, sheetUrl, users, sprints, clans, homeText, auth] = await Promise.all([
      getCharacters(),
      getImagesMeta(),
      getSettingRaw('sheetUrl'),
      getSettingRaw('users'),
      getSettingRaw('sprints'),
      getSettingRaw('clans'),
      getSettingRaw('homeText'),
      getSettingRaw('auth')
    ]);
    const images = imagesMeta.map(function (m) {
      return { id: m.id, charId: m.charId, name: m.name, ts: m.ts, data: '/api/image?id=' + encodeURIComponent(m.id) };
    });
    return json(200, {
      characters: characters,
      images: images,
      settings: {
        sheetUrl: sheetUrl || '',
        users: users || null,
        sprints: sprints || null,
        clans: clans || null,
        homeText: homeText || null,
        hasAdminPassword: !!(auth && auth.hash)
      }
    });
  } catch (e) {
    return json(500, { error: 'Server error: ' + e.message });
  }
};
