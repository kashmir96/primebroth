/**
 * loyalty-rates.js
 *
 * Public GET endpoint returning current points rates + per-SKU overrides.
 * Called by product pages, cart, checkout to display accurate points estimates.
 *
 * GET /.netlify/functions/loyalty-rates
 *
 * Returns:
 *   { points_per_dollar, overrides: { "sku": multiplier, ... } }
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300', // 5 min cache
};

function sbFetch(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  try {
    const [settingsRes, overridesRes] = await Promise.all([
      sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=points_per_dollar'),
      sbFetch('/rest/v1/sku_points_overrides?select=sku,multiplier'),
    ]);

    const settingsArr = await settingsRes.json();
    const overridesArr = await overridesRes.json();

    const pointsPerDollar = settingsArr?.[0]?.points_per_dollar || 100;

    const overrides = {};
    if (Array.isArray(overridesArr)) {
      overridesArr.forEach(r => {
        if (r.multiplier && r.multiplier !== 1) {
          overrides[r.sku] = Number(r.multiplier);
          // Also key by description (product name) for fuzzy frontend matching
          if (r.description) {
            overrides[r.description.toLowerCase()] = Number(r.multiplier);
          }
        }
      });
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ points_per_dollar: pointsPerDollar, overrides }),
    };
  } catch (err) {
    console.error('[loyalty-rates]', err.message);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ points_per_dollar: 100, overrides: {} }),
    };
  }
};
