// netlify/functions/get-catalog.js
//
// Pulls the live catalog + inventory from Orion Wholesale, applies pricing rules,
// and returns clean, ready-to-display JSON to catalog.html.
//
// The Orion API key never reaches the browser -- it lives only here, as a Netlify
// environment variable (ORION_API_KEY), set in: Site settings > Environment variables.

const ORION_BASE = 'https://orionfflsales.com/api.php';

// ============================================================
// PRICING RULES
// Edit this any time you want to change your margin strategy.
// Rules are checked top to bottom -- the FIRST one where the item's
// cost is <= maxCost wins. No need to touch anything else in this file.
// ============================================================
const PRICING_RULES = [
  { maxCost: 500,      type: 'flat',    amount: 30 },  // cheaper items: flat $30 over cost/MAP
  { maxCost: Infinity, type: 'percent', amount: 20 }    // everything else: 20% over cost/MAP
];

// ============================================================
// CATEGORY MAPPING
// Maps Orion's category names (left) to your 6 site categories (right).
// Any Orion category NOT listed here is skipped -- add a line to include it.
// Add category names in ALL CAPS exactly as Orion sends them.
// ============================================================
const CATEGORY_MAP = {
  'PISTOLS': 'Handguns',
  'HANDGUNS': 'Handguns',
  'REVOLVERS': 'Handguns',
  'RIFLES': 'Rifles',
  'AR-15': 'Rifles',
  'AR15': 'Rifles',
  'BOLT ACTION': 'Rifles',
  'PISTOL CALIBER CARBINES': 'PCCs',
  'PCC': 'PCCs',
  'PCCS': 'PCCs',
  'OPTICS': 'Optics',
  'RED DOTS': 'Optics',
  'SCOPES': 'Optics',
  'PLATE CARRIERS': 'Plate Carriers & Gear',
  'BODY ARMOR': 'Plate Carriers & Gear',
  'HOLSTERS': 'Plate Carriers & Gear',
  'BELTS': 'Plate Carriers & Gear',
  'AMMO': 'Ammo & Accessories',
  'AMMUNITION': 'Ammo & Accessories',
  'MAGAZINES': 'Ammo & Accessories',
  'ACCESSORIES': 'Ammo & Accessories',
  'LIGHTS': 'Ammo & Accessories'
};

function calcPrice(cost, map) {
  const costNum = parseFloat(cost) || 0;
  const mapNum = parseFloat(map) || 0;
  const base = mapNum > 0 ? mapNum : costNum;

  const rule = PRICING_RULES.find(r => costNum <= r.maxCost) || PRICING_RULES[PRICING_RULES.length - 1];
  let price = rule.type === 'flat' ? base + rule.amount : base * (1 + rule.amount / 100);

  // Legal floor: never display below MAP if a MAP exists.
  if (mapNum > 0 && price < mapNum) price = mapNum;

  return Math.round(price * 100) / 100;
}

exports.handler = async function (event, context) {
  const API_KEY = process.env.ORION_API_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing ORION_API_KEY environment variable in Netlify site settings.' })
    };
  }

  try {
    const headers = { 'Connection-Key': API_KEY };

    const [catalogRes, inventoryRes] = await Promise.all([
      fetch(`${ORION_BASE}?method=get_catalog`, { headers }),
      fetch(`${ORION_BASE}?method=get_catalog_inventory`, { headers })
    ]);

    if (!catalogRes.ok || !inventoryRes.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Orion API request failed', catalogStatus: catalogRes.status, inventoryStatus: inventoryRes.status })
      };
    }

    const catalogData = await catalogRes.json();
    const inventoryData = await inventoryRes.json();

    // Build a quick lookup of product_id -> quantity on hand
    const inventoryMap = {};
    const invList = inventoryData.inventory || inventoryData.products || inventoryData.items || [];
    invList.forEach(item => {
      const qty = item.quantity ?? item.qty ?? item.on_hand ?? 0;
      inventoryMap[item.product_id] = qty;
    });

    const items = (catalogData.products || [])
      .map(p => {
        const qty = inventoryMap[p.product_id] ?? 0;
        if (qty <= 0) return null; // skip out-of-stock items

        const rawCategory = (p.product_categories || '').split(',')[0].trim().toUpperCase();
        const mappedCategory = CATEGORY_MAP[rawCategory];
        if (!mappedCategory) return null; // skip categories we haven't mapped yet

        return {
          id: p.product_id,
          code: p.product_code,
          name: p.description,
          detail: p.detailed_description || '',
          manufacturer: p.product_manufacturer || '',
          category: mappedCategory,
          image: p.image_url || null,
          upc: p.upc_code || '',
          qty,
          price: calcPrice(p.base_cost ?? p.list_price, p.manufacturer_advertised_price)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // browsers/CDN cache for 1 hour -- keeps this fast and cheap
      },
      body: JSON.stringify({ items, updated: new Date().toISOString() })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
