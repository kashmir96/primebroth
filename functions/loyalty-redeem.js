/**
 * loyalty-redeem.js
 *
 * Redeems PrimalPoints for a Stripe promo code.
 *
 * POST /.netlify/functions/loyalty-redeem
 * Body: { session_token, points_to_redeem }
 *   — OR legacy: { email, points_to_redeem } (for admin use only)
 *
 * Security:
 *   - Requires valid session token (from loyalty-auth.js)
 *   - Rate limited to 3 redemptions per email per day
 *
 * Returns: { promo_code, dollar_value, new_balance }
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, STRIPE_SECRET_KEY
 */

const { resolveSession } = require('./loyalty-auth');

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

async function getBalance(email) {
  const now = new Date().toISOString();
  const res = await sbFetch(`/rest/v1/loyalty_points?email=eq.${encodeURIComponent(email)}&select=points,expires_at`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, r) => {
    if (r.expires_at === null || r.expires_at > now) return sum + r.points;
    return sum;
  }, 0);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { session_token, email: legacyEmail, points_to_redeem } = JSON.parse(event.body || '{}');
    if (!points_to_redeem) return reply(400, { error: 'points_to_redeem required' });

    // Resolve email from session token (secure) or fall back to legacy email (for admin/webhook use)
    let emailLower;
    if (session_token) {
      emailLower = await resolveSession(session_token);
      if (!emailLower) return reply(401, { error: 'Invalid or expired session. Please log in again.' });
    } else if (legacyEmail) {
      // Legacy path — only allow if called from admin (check for staff token)
      const staffToken = event.headers['x-staff-token'] || '';
      if (staffToken !== process.env.OSO_STAFF_TOKEN) {
        return reply(401, { error: 'Authentication required. Please log in.' });
      }
      emailLower = legacyEmail.toLowerCase();
    } else {
      return reply(400, { error: 'session_token required' });
    }

    // Rate limit: max 3 redemptions per email per day
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rateRes = await sbFetch(
      `/rest/v1/loyalty_points?email=eq.${encodeURIComponent(emailLower)}&type=eq.redeem&created_at=gte.${encodeURIComponent(oneDayAgo)}&select=id`
    );
    const recentRedemptions = await rateRes.json();
    if (Array.isArray(recentRedemptions) && recentRedemptions.length >= 3) {
      return reply(429, { error: 'Too many redemptions today. Please try again tomorrow.' });
    }

    const pointsToRedeem = Math.floor(Number(points_to_redeem));

    // Get settings
    const settingsRes = await sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=*');
    const settingsArr = await settingsRes.json();
    const settings = settingsArr?.[0] || { points_to_dollar_rate: 2000, min_redemption_points: 2000 };

    if (pointsToRedeem < settings.min_redemption_points) {
      return reply(400, { error: `Minimum redemption is ${settings.min_redemption_points} points` });
    }

    // Verify balance
    const balance = await getBalance(emailLower);
    if (balance < pointsToRedeem) {
      return reply(400, { error: `Insufficient balance. You have ${balance} points.` });
    }

    // Calculate dollar value
    const dollarValue = Math.floor(pointsToRedeem / settings.points_to_dollar_rate);
    if (dollarValue < 1) return reply(400, { error: 'Redemption too small — not enough points for $1' });

    // Create Stripe promo code
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Create a coupon for this exact amount
    const coupon = await stripe.coupons.create({
      amount_off: dollarValue * 100, // in cents
      currency: 'nzd',
      duration: 'once',
      name: `PrimalPoints Redemption ($${dollarValue})`,
    });

    // Create promo code tied to this email
    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    const promoCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: `POINTS-${suffix}`,
      max_redemptions: 1,
      expires_at: Math.floor((Date.now() + 60 * 24 * 60 * 60 * 1000) / 1000), // 60 days
      restrictions: {
        minimum_amount: 100, // $1 minimum order
        minimum_amount_currency: 'nzd',
      },
    });

    // Deduct points from ledger
    await sbFetch('/rest/v1/loyalty_points', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        email: emailLower,
        points: -pointsToRedeem,
        type: 'redeem',
        description: `Redeemed ${pointsToRedeem.toLocaleString()} pts for $${dollarValue} off — code ${promoCode.code}`,
        expires_at: null,
      },
    });

    const newBalance = await getBalance(emailLower);

    console.log(`[loyalty-redeem] ${emailLower} redeemed ${pointsToRedeem}pts → $${dollarValue} | code: ${promoCode.code}`);

    return reply(200, {
      promo_code: promoCode.code,
      dollar_value: dollarValue,
      new_balance: Math.max(0, newBalance),
    });
  } catch (err) {
    console.error('[loyalty-redeem] Error:', err.message);
    return reply(500, { error: 'Internal error' });
  }
};
