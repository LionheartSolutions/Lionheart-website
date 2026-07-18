// netlify/functions/_catalog-helpers.js
//
// Shared logic used by sync-catalog.js. Not deployed as its own function
// (files starting with "_" are ignored by Netlify's function bundler).

// ============================================================
// PRICING RULES
// Edit any time you want to change your margin strategy.
// Rules are checked top to bottom -- the FIRST one where the item's
// cost is <= maxCost wins.
// ============================================================
const PRICING_RULES = [
  { maxCost: 500,      type: 'flat',    amount: 30 },  // cheaper items: flat $30 over cost/MAP
  { maxCost: Infinity, type: 'percent', amount: 20 }    // everything else: 20% over cost/MAP
];

// ============================================================
// CATEGORY MAPPING
// Maps Orion's category names (left) to your 6 site categories (right).
// Any Orion category NOT listed here is skipped -- add a line to include it.
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

  if (mapNum > 0 && price < mapNum) price = mapNum; // legal floor: never below MAP

  return Math.round(price * 100) / 100;
}

function buildItems(catalogProducts, inventoryMap) {
  return (catalogProducts || [])
    .map(p => {
      const qty = inventoryMap[p.product_id] ?? 0;
      if (qty <= 0) return null;

      const rawCategory = (p.product_categories || '').split(',')[0].trim().toUpperCase();
      const mappedCategory = CATEGORY_MAP[rawCategory];
      if (!mappedCategory) return null;

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
}

module.exports = { buildItems };
