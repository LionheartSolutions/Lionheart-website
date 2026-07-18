// netlify/functions/get-catalog.js
//
// This is what catalog.html fetches on page load. It does NOT talk to Orion
// directly -- it just reads whatever sync-catalog.js last saved to Netlify
// Blobs, so it responds instantly and can't time out.
//
// If this returns an empty item list, it usually means sync-catalog.js
// hasn't run yet. Trigger it manually once: Netlify dashboard -> your site
// -> Functions -> sync-catalog -> "Run now".

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event, context) {
  const BLOBS_SITE_ID = process.env.BLOBS_SITE_ID;
  const BLOBS_TOKEN = process.env.BLOBS_TOKEN;

  if (!BLOBS_SITE_ID || !BLOBS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing BLOBS_SITE_ID or BLOBS_TOKEN environment variable.' }) };
  }

  try {
    const store = getStore({ name: 'catalog', siteID: BLOBS_SITE_ID, token: BLOBS_TOKEN });
    const data = await store.get('items', { type: 'json' });

    if (!data) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [], updated: null })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // 5 min browser cache, cheap and fast
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
