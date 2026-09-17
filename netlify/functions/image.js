const { connectLambda, imageStore, json } = require('./_lib');

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const id = (event.queryStringParameters || {}).id;
  if (!id) return json(400, { error: 'Missing id' });
  try {
    const result = await imageStore().getWithMetadata(id, { type: 'arrayBuffer' });
    if (!result) return json(404, { error: 'Not found' });
    const contentType = (result.metadata && result.metadata.contentType) || 'application/octet-stream';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      },
      body: Buffer.from(result.data).toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return json(404, { error: 'Not found' });
  }
};
