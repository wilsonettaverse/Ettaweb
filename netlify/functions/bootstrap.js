const { connectLambda, getCharacters, getTasks, getImagesMeta, getSettingRaw, json } = require('./_lib');

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const [characters, tasks, imagesMeta, sheetUrl, adminEmail, users, sprints, artistGoals, clans, homeText, auth] = await Promise.all([
      getCharacters(),
      getTasks(),
      getImagesMeta(),
      getSettingRaw('sheetUrl'),
      getSettingRaw('adminEmail'),
      getSettingRaw('users'),
      getSettingRaw('sprints'),
      getSettingRaw('artistGoals'),
      getSettingRaw('clans'),
      getSettingRaw('homeText'),
      getSettingRaw('auth')
    ]);
    const images = imagesMeta.map(function (m) {
      return { id: m.id, charId: m.charId, name: m.name, ts: m.ts, by: m.by || null, data: '/api/image?id=' + encodeURIComponent(m.id) };
    });
    return json(200, {
      characters: characters,
      tasks: tasks,
      images: images,
      settings: {
        sheetUrl: sheetUrl || '',
        adminEmail: adminEmail || '',
        users: users || null,
        sprints: sprints || null,
        artistGoals: artistGoals || null,
        clans: clans || null,
        homeText: homeText || null,
        hasAdminPassword: !!(auth && auth.hash)
      }
    });
  } catch (e) {
    return json(500, { error: 'Server error: ' + e.message });
  }
};
