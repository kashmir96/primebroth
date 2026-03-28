/**
 * affiliate-dashboard-data.js
 *
 * Authenticated data proxy for the affiliate portal.
 * Validates session_token against affiliates table, then returns
 * the affiliate's own data (profile, orders, payouts).
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, body) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(body) };
}

function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function getAffiliateByToken(token) {
  if (!token || token.length !== 64) return null;
  const res = await sbFetch(
    `/rest/v1/affiliates?session_token=eq.${encodeURIComponent(token)}&status=eq.approved&select=*&limit=1`
  );
  const rows = await res.json();
  return (rows && rows.length > 0) ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { session_token, action } = JSON.parse(event.body);

    const affiliate = await getAffiliateByToken(session_token);
    if (!affiliate) return reply(401, { error: 'Not authenticated. Please log in again.' });

    // ── Profile ──
    if (action === 'profile') {
      return reply(200, {
        success: true,
        affiliate: {
          id: affiliate.id,
          name: affiliate.name,
          email: affiliate.email,
          affiliate_code: affiliate.affiliate_code,
          referral_link: affiliate.referral_link,
          commission_rate: affiliate.commission_rate,
          discount_rate: affiliate.discount_rate,
          total_clicks: affiliate.total_clicks || 0,
          total_orders: affiliate.total_orders || 0,
          total_revenue: affiliate.total_revenue || 0,
          total_commission: affiliate.total_commission || 0,
          total_paid: affiliate.total_paid || 0,
          approved_at: affiliate.approved_at,
        },
      });
    }

    // ── Orders ──
    if (action === 'orders') {
      const res = await sbFetch(
        `/rest/v1/affiliate_orders?affiliate_id=eq.${affiliate.id}&select=*&order=created_at.desc&limit=50`
      );
      const orders = await res.json();
      return reply(200, { success: true, orders: orders || [] });
    }

    // ── Payouts ──
    if (action === 'payouts') {
      const res = await sbFetch(
        `/rest/v1/affiliate_payouts?affiliate_id=eq.${affiliate.id}&select=*&order=created_at.desc`
      );
      const payouts = await res.json();
      return reply(200, { success: true, payouts: payouts || [] });
    }

    return reply(400, { error: 'Invalid action.' });

  } catch (err) {
    console.error('[affiliate-dashboard-data] Error:', err.message);
    return reply(500, { error: 'Something went wrong.' });
  }
};
