/**
 * quiz-referral.js
 *
 * Handles the refer-a-friend flow from the skin compatibility quiz:
 * 1. Validates referrer hasn't exceeded 3 referrals
 * 2. Validates friend email is not an existing customer
 * 3. Creates unique promo codes against one master coupon (QUIZ_REFERRAL_COUPON_ID)
 * 4. Codes expire in 30 days, max 1 redemption each
 * 5. Emails both parties their codes via Gmail
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY         — NZ Stripe secret key
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_KEY      — Supabase service_role key
 *   QUIZ_REFERRAL_COUPON_ID   — Stripe coupon ID to attach promo codes to
 *   GOOGLE_CLIENT_ID          — Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET      — Google OAuth client secret
 *   GMAIL_ACCOUNT_ID          — (optional) ID of gmail_accounts row to send from
 */

const { sendEmail, referrerEmailHtml, friendEmailHtml } = require('./send-quiz-email');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const MAX_REFERRALS_PER_EMAIL = 3;
const EXPIRY_DAYS = 30;

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

function formatExpiryDate(date) {
  return date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { referrerEmail, friendEmail, utm } = JSON.parse(event.body);
    const utmData = utm || {};

    // ── Basic validation ──
    if (!referrerEmail || !friendEmail) {
      return reply(400, { error: 'Both emails are required.' });
    }
    if (!referrerEmail.match(/.+@.+\..+/) || !friendEmail.match(/.+@.+\..+/)) {
      return reply(400, { error: 'Please enter valid email addresses.' });
    }
    if (referrerEmail.toLowerCase() === friendEmail.toLowerCase()) {
      return reply(400, { error: 'You can\'t refer yourself!' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (supabaseUrl && supabaseKey) {
      // ── Check referrer hasn't exceeded max referrals ──
      const referralCountRes = await sbFetch(
        `/rest/v1/quiz_referrals?referrer_email=eq.${encodeURIComponent(referrerEmail.toLowerCase())}&select=id`
      );
      const existingReferrals = await referralCountRes.json();
      if (existingReferrals && existingReferrals.length >= MAX_REFERRALS_PER_EMAIL) {
        return reply(400, { error: `You've already referred ${MAX_REFERRALS_PER_EMAIL} friends — that's the maximum. Thanks for spreading the word!` });
      }

      // ── Check friend hasn't already been referred ──
      // Silent success — don't reveal whether this email is in the system
      const friendReferredRes = await sbFetch(
        `/rest/v1/quiz_referrals?friend_email=eq.${encodeURIComponent(friendEmail.toLowerCase())}&select=id&limit=1`
      );
      const alreadyReferred = await friendReferredRes.json();
      if (alreadyReferred && alreadyReferred.length > 0) {
        return reply(200, { success: true, alreadySent: true, friendCode: null, expiryDate: null });
      }

      // ── Check friend isn't an existing customer ──
      // Silent success — don't reveal customer status
      const checkRes = await sbFetch(
        `/rest/v1/orders?email=eq.${encodeURIComponent(friendEmail.toLowerCase())}&select=id&limit=1`
      );
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        return reply(200, { success: true, alreadySent: true, friendCode: null, expiryDate: null });
      }
    }

    // ── Create Stripe promo codes against master coupon ──
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const couponId = process.env.QUIZ_REFERRAL_COUPON_ID;

    if (!couponId) {
      console.error('[quiz-referral] QUIZ_REFERRAL_COUPON_ID env var not set');
      return reply(500, { error: 'Referral system not configured. Please contact us.' });
    }

    const expiryDate = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const expiresAt = Math.floor(expiryDate.getTime() / 1000); // Unix timestamp for Stripe
    const suffix = Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

    // Only create the friend's code now.
    // The referrer's code is created by stripe-webhook.js when the friend redeems.
    const friendPromo = await stripe.promotionCodes.create({
      coupon: couponId,
      code: 'QUIZ-' + suffix + '-FRIEND',
      max_redemptions: 1,
      expires_at: expiresAt,
      restrictions: {
        first_time_transaction: true,
        minimum_amount: 2500,
        minimum_amount_currency: 'nzd',
      },
      metadata: {
        type: 'friend',
        referrer_email: referrerEmail.toLowerCase(),
        friend_email: friendEmail.toLowerCase(),
      },
    });

    const expiryFormatted = formatExpiryDate(expiryDate);

    // ── Save referral to Supabase (non-blocking — never let a DB error kill the flow) ──
    // NOTE: quiz_referrals table requires: referrer_rewarded boolean DEFAULT false, referrer_code text nullable
    if (supabaseUrl && supabaseKey) {
      sbFetch('/rest/v1/quiz_referrals', {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          referrer_email: referrerEmail.toLowerCase(),
          friend_email: friendEmail.toLowerCase(),
          referrer_code: null,
          referrer_rewarded: false,
          friend_code: friendPromo.code,
          expires_at: expiryDate.toISOString(),
          utm_source: utmData.source || null,
          utm_medium: utmData.medium || null,
          utm_campaign: utmData.campaign || null,
          utm_term: utmData.term || null,
          utm_content: utmData.content || null,
          created_at: new Date().toISOString(),
        },
      }).catch(err => console.error('[quiz-referral] Supabase insert error:', err.message));
    }

    // ── Store friend as a lead in quiz_leads (non-blocking) ──
    // This ensures order-linking in checkout-completed.js picks them up automatically.
    // Only insert if no existing record — ignore duplicate email errors.
    if (supabaseUrl && supabaseKey) {
      sbFetch('/rest/v1/quiz_leads', {
        method: 'POST',
        prefer: 'return=minimal,resolution=ignore-duplicates',
        body: {
          email: friendEmail.toLowerCase(),
          utm_source: 'referral',
          utm_medium: 'email',
          utm_campaign: 'friend-voucher',
          referrer: referrerEmail.toLowerCase(),
          landing_page: '/referral',
          recommended_products: [],
          created_at: new Date().toISOString(),
        },
      }).catch(err => console.error('[quiz-referral] Lead insert error:', err.message));
    }

    // ── Send friend's code email only (referrer gets theirs when friend redeems) ──
    sendEmail({
      to: friendEmail,
      subject: 'Someone shared $5 off PrimalPantry with you',
      html: friendEmailHtml({ code: friendPromo.code, expiryDate: expiryFormatted, referrerEmail }),
    }).catch(err => console.error('[quiz-referral] Email send error:', err.message));

    return reply(200, {
      success: true,
      friendCode: friendPromo.code,
      expiryDate: expiryFormatted,
    });

  } catch (err) {
    console.error('[quiz-referral] Error:', err.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};
