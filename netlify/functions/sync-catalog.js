// netlify/functions/sync-catalog.js
//
// Runs automatically every 6 hours (see netlify.toml). Pulls the full catalog
// AND current stock quantities from Orion, drops out-of-stock items, applies
// pricing rules, and saves the result to Netlify Blobs.
// catalog.html never talks to Orion directly -- it reads this cached result
// via get-catalog.js, which is fast and can't time out.
//
// Note: this only checks whether quantity is above zero -- it does NOT
// display live stock counts on the site. That's a deliberate choice: Orion's
// on-hand numbers can shift between syncs, and since purchases go through a
// manual follow-up call rather than instant checkout, showing an exact "3
// left" count would be misleading. If the item happens to sell out in the
// gap between syncs, that's still handled as "sorry, that one's not
// available" during the follow-up call -- same as before.
//
// The catalog and inventory calls run IN PARALLEL (not one after another).
// With ~15,000 products, Orion's two endpoints are slow enough that running
// them sequentially can push this past Netlify's function time limit and
// get the whole run killed silently before anything is saved. Running them
// at the same time roughly halves the total wait.
//
// If the inventory call fails for any reason, the sync does NOT abort or
// wipe the catalog -- it just skips the stock filter for that run and shows
// every mapped item as if in stock, same as the site behaved previously.
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

    // Fire both requests at once instead of waiting for the first to finish
    // before starting the second.
    const [catalogResult, inventoryResult] = await Promise.allSettled([
      fetch(`${ORION_BASE}?method=get_catalog`, { headers }),
      fetch(`${ORION_BASE}?method=get_catalog_inventory`, { headers })
    ]);

    if (catalogResult.status !== 'fulfilled' || !catalogResult.value.ok) {
      console.error('Orion catalog request failed', catalogResult.status === 'fulfilled' ? catalogResult.value.status : catalogResult.reason);
      return { statusCode: 502 };
    }

    const catalogData = await catalogResult.value.json();
    const rawProducts = catalogData.products || [];
    console.log(`Orion returned ${rawProducts.length} raw catalog products.`);

    // Inventory is best-effort -- if it failed or is slow, we still proceed
    // without stock filtering rather than failing the entire sync.
    let inventoryMap = null;
    if (inventoryResult.status === 'fulfilled' && inventoryResult.value.ok) {
      try {
        const inventoryData = await inventoryResult.value.json();
        // Response is keyed by product_id: { "55766": { product_id, product_code, quantity, sale_price }, ... }
        const rawInventory = inventoryData.product_inventory || {};
        inventoryMap = {};
        Object.keys(rawInventory).forEach(productId => {
          inventoryMap[productId] = rawInventory[productId].quantity;
        });
        console.log(`Orion returned inventory data for ${Object.keys(inventoryMap).length} products.`);
      } catch (parseErr) {
        console.error('Failed to parse Orion inventory response:', parseErr.message, '-- continuing without stock filtering.');
      }
    } else {
      const reason = inventoryResult.status === 'fulfilled' ? inventoryResult.value.status : inventoryResult.reason;
      console.error('Orion inventory request failed:', reason, '-- continuing without stock filtering.');
    }

    const items = buildItems(rawProducts, inventoryMap);
    console.log(`After category + stock filtering: ${items.length} items remain.`);

    // Safety check: if we somehow ended up with zero items, don't overwrite
    // the last known-good catalog with an empty one. Better to keep showing
    // yesterday's data than to break the site.
    if (items.length === 0) {
      console.error('Sync produced 0 items -- aborting write to preserve last good catalog.');
      return { statusCode: 500 };
    }

    const store = getStore({ name: 'catalog', siteID: BLOBS_SITE_ID, token: BLOBS_TOKEN });
    await store.setJSON('items', { items, updated: new Date().toISOString() });
    console.log(`Synced ${items.length} mapped items from Orion.`);

    return { statusCode: 200 };
  } catch (err) {
    console.error('sync-catalog error:', err.message);
    return { statusCode: 500 };
  }
};
