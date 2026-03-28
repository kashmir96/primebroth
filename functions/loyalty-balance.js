/**
 * loyalty-balance.js
 *
 * Returns the current PrimalPoints balance for an email address.
 * Public GET endpoint — used by the thank-you page.
 *
 * GET /.netlify/functions/loyalty-balance?email=x@y.com
 *
 * Returns:
 *   { balance, pending_expiry, expiry_date, points_to_dollar_rate, min_redemption_points }
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
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

  const email = event.queryStringParameters?.email;
  if (!email) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'email required' }) };

  try {
    const now = new Date().toISOString();
    const emailLower = email.toLowerCase();

    // Fetch all point rows for this email
    const [rowsRes, settingsRes] = await Promise.all([
      sbFetch(`/rest/v1/loyalty_points?email=eq.${encodeURIComponent(emailLower)}&select=points,expires_at,created_at`),
      sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=points_to_dollar_rate,min_redemption_points,points_per_dollar'),
    ]);

    const rows = await rowsRes.json();
    const settingsArr = await settingsRes.json();
    const settings = settingsArr?.[0] || { points_to_dollar_rate: 100, min_redemption_points: 500, points_per_dollar: 100 };

    if (!Array.isArray(rows)) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ balance: 0, pending_expiry: 0, expiry_date: null, ...settings }) };
    }

    // Active balance (non-expired)
    const balance = rows.reduce((sum, r) => {
      if (r.expires_at === null || r.expires_at > now) return sum + r.points;
      return sum;
    }, 0);

    // Points expiring soonest (within 7 days)
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const expiringSoon = rows
      .filter(r => r.expires_at && r.expires_at > now && r.expires_at <= soon && r.points > 0)
      .reduce((sum, r) => sum + r.points, 0);

    // Earliest expiry date among active positive rows
    const activeExpiries = rows
      .filter(r => r.points > 0 && r.expires_at && r.expires_at > now)
      .map(r => r.expires_at)
      .sort();
    const expiryDate = activeExpiries[0] || null;

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        balance: Math.max(0, balance),
        pending_expiry: expiringSoon,
        expiry_date: expiryDate,
        points_to_dollar_rate: settings.points_to_dollar_rate,
        min_redemption_points: settings.min_redemption_points,
        points_per_dollar: settings.points_per_dollar,
      }),
    };
  } catch (err) {
    console.error('[loyalty-balance]', err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
