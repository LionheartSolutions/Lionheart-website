// netlify/functions/sync-catalog.js
//
// Runs automatically every 6 hours (see netlify.toml). Pulls the full catalog
// from Orion, applies pricing rules, and saves the result to Netlify Blobs.
// catalog.html never talks to Orion directly -- it reads this cached result
// via get-catalog.js, which is fast and can't time out.
//
// Note: this does NOT check stock levels -- every mapped item from Orion's
// catalog shows on the site regardless of availability. Since purchases go
// through manual approval (not instant checkout), an occasional out-of-stock
// request just gets handled as "sorry, that one's not available" during
// the follow-up call.
//
// You can also trigger this manually any time: Netlify dashboard -> your site
// -> Functions -> sync-catalog -> "Run now". Useful right after deploying,
// so you don't have to wait up to 6 hours for the first sync.

const { getStore } = require('@netlify/blobs');
const { buildItems } = require('./_catalog-helpers');

const ORION_BASE = 'https://orionfflsales.com/api.php';

exports.handler = async function (event, context) {
  const API_KEY = process.env.ORION_API_KEY;
  const BLOBS_SITE_ID = process.env.BLOBS_SITE_ID;
  const BLOBS_TOKEN = process.env.BLOBS_TOKEN;

  if (!API_KEY) {
    console.error('Missing ORION_API_KEY environment variable.');
    return { statusCode: 500 };
  }
  if (!BLOBS_SITE_ID || !BLOBS_TOKEN) {
    console.error('Missing BLOBS_SITE_ID or BLOBS_TOKEN environment variable.');
    return { statusCode: 500 };
  }

  try {
    const headers = { 'Connection-Key': API_KEY };

    const catalogRes = await fetch(`${ORION_BASE}?method=get_catalog`, { headers });

    if (!catalogRes.ok) {
      console.error('Orion API request failed', catalogRes.status);
      return { statusCode: 502 };
    }

    const catalogData = await catalogRes.json();
    const rawProducts = catalogData.products || [];
    console.log(`Orion returned ${rawProducts.length} raw catalog products.`);

    const items = buildItems(rawProducts);
    console.log(`After category filtering: ${items.length} items remain.`);

    const store = getStore({ name: 'catalog', siteID: BLOBS_SITE_ID, token: BLOBS_TOKEN });
    await store.setJSON('items', { items, updated: new Date().toISOString() });

    console.log(`Synced ${items.length} mapped items from Orion.`);
    return { statusCode: 200 };
  } catch (err) {
    console.error('sync-catalog error:', err.message);
    return { statusCode: 500 };
  }
};
