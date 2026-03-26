/**
 * quiz-referral.js
 *
 * Handles the refer-a-friend flow from the skin compatibility quiz:
 * 1. Validates friend email is not an existing customer
 * 2. Generates unique $5 Stripe promo codes for both parties
 * 3. Returns success/error
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY     — NZ Stripe secret key
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, body) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { referrerEmail, friendEmail } = JSON.parse(event.body);

    if (!referrerEmail || !friendEmail) {
      return reply(400, { error: 'Both emails are required.' });
    }

    if (referrerEmail.toLowerCase() === friendEmail.toLowerCase()) {
      return reply(400, { error: 'You can\'t refer yourself!' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    // Check if friend email already exists in orders table
    if (supabaseUrl && supabaseKey) {
      const checkRes = await fetch(
        `${supabaseUrl}/rest/v1/orders?email=eq.${encodeURIComponent(friendEmail.toLowerCase())}&select=id&limit=1`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        return reply(400, { error: 'This email belongs to an existing customer. Referrals are for new customers only.' });
      }
    }

    // Create Stripe coupon and promo codes
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Create a shared coupon ($5 off)
    const coupon = await stripe.coupons.create({
      amount_off: 500, // $5.00 in cents
      currency: 'nzd',
      duration: 'once',
      name: 'Skin Quiz Referral - $5 Off',
    });

    // Generate unique promo codes for each person
    const suffix = Date.now().toString(36).toUpperCase();
    const referrerCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: 'REFER-' + suffix + '-A',
      max_redemptions: 1,
    });
    const friendCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: 'REFER-' + suffix + '-B',
      max_redemptions: 1,
    });

    // Save referral to Supabase
    if (supabaseUrl && supabaseKey) {
      await fetch(`${supabaseUrl}/rest/v1/quiz_referrals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          referrer_email: referrerEmail.toLowerCase(),
          friend_email: friendEmail.toLowerCase(),
          referrer_code: referrerCode.code,
          friend_code: friendCode.code,
          created_at: new Date().toISOString(),
        }),
      });
    }

    return reply(200, {
      success: true,
      referrerCode: referrerCode.code,
      friendCode: friendCode.code,
    });
  } catch (err) {
    console.error('[quiz-referral] Error:', err.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};
