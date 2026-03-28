/**
 * affiliate-track.js
 *
 * Lightweight click tracking for affiliate referral links.
 * Called when a visitor lands with ?ref= parameter.
 * Increments click count and logs to affiliate_clicks.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const crypto = require('crypto');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function reply(code, body) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');

  try {
    const params = event.queryStringParameters || {};
    const code = params.code;
    if (!code) return reply(200, { ok: true });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return reply(200, { ok: true });

    const headers = {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    };

    // Look up affiliate by code
    const affRes = await fetch(`${url}/rest/v1/affiliates?affiliate_code=eq.${encodeURIComponent(code)}&status=eq.approved&select=id,total_clicks&limit=1`, { headers });
    const affiliates = await affRes.json();
    if (!affiliates || affiliates.length === 0) return reply(200, { ok: true });

    const affiliate = affiliates[0];

    // Hash IP for privacy
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip + code).digest('hex').slice(0, 16);

    // Log click (non-blocking)
    fetch(`${url}/rest/v1/affiliate_clicks`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        affiliate_id: affiliate.id,
        ip_hash: ipHash,
        user_agent: (event.headers['user-agent'] || '').slice(0, 200),
        landing_page: params.page || '/',
        created_at: new Date().toISOString(),
      }),
    }).catch(() => {});

    // Increment click count
    fetch(`${url}/rest/v1/affiliates?id=eq.${affiliate.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ total_clicks: (affiliate.total_clicks || 0) + 1 }),
    }).catch(() => {});

    return reply(200, { ok: true });

  } catch (err) {
    // Never fail — this is fire-and-forget tracking
    return reply(200, { ok: true });
  }
};
