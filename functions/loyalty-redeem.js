/**
 * loyalty-redeem.js
 *
 * Redeems PrimalPoints for a Stripe promo code.
 *
 * POST /.netlify/functions/loyalty-redeem
 * Body: { email, points_to_redeem }
 *
 * Returns: { promo_code, dollar_value, new_balance }
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, STRIPE_SECRET_KEY
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
    const { email, points_to_redeem } = JSON.parse(event.body || '{}');
    if (!email || !points_to_redeem) return reply(400, { error: 'email and points_to_redeem required' });

    const emailLower = email.toLowerCase();
    const pointsToRedeem = Math.floor(Number(points_to_redeem));

    // Get settings
    const settingsRes = await sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=*');
    const settingsArr = await settingsRes.json();
    const settings = settingsArr?.[0] || { points_to_dollar_rate: 100, min_redemption_points: 500 };

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
