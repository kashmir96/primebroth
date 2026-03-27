/**
 * stripe-webhook.js
 *
 * Handles Stripe webhook events. Currently processes:
 *   checkout.session.completed — detects when a friend referral code was used
 *   and rewards the referrer with their $5 off code.
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY         — NZ Stripe secret key
 *   STRIPE_WEBHOOK_SECRET     — Stripe webhook signing secret (from Dashboard → Webhooks)
 *   QUIZ_REFERRAL_COUPON_ID   — Stripe coupon ID to attach referrer promo codes to
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_KEY      — Supabase service_role key
 *
 * Supabase: quiz_referrals table must have columns:
 *   referrer_rewarded  boolean  default false
 *   referrer_code      text     nullable
 *
 * Register this endpoint in Stripe Dashboard → Webhooks:
 *   URL: https://www.primalpantry.co.nz/.netlify/functions/stripe-webhook
 *   Event: checkout.session.completed
 */

const { sendEmail, referrerRewardEmailHtml } = require('./send-quiz-email');

const EXPIRY_DAYS = 30;
const MIN_ORDER_CENTS = 2500; // $25 NZD

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

exports.handler = async (event) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    console.error('[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return { statusCode: 500, body: 'Server misconfiguration' };
  }

  const stripe = require('stripe')(stripeKey);

  // Verify Stripe signature
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['stripe-signature'],
      webhookSecret
    );
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session = stripeEvent.data.object;
  const discounts = session.discounts || [];

  if (discounts.length === 0) {
    return { statusCode: 200, body: 'No discounts applied' };
  }

  const couponId = process.env.QUIZ_REFERRAL_COUPON_ID;
  if (!couponId) {
    console.error('[stripe-webhook] QUIZ_REFERRAL_COUPON_ID not set');
    return { statusCode: 500, body: 'Server misconfiguration' };
  }

  for (const discount of discounts) {
    const promoCodeId = typeof discount.promotion_code === 'string'
      ? discount.promotion_code
      : discount.promotion_code?.id;
    if (!promoCodeId) continue;

    let promoCode;
    try {
      promoCode = await stripe.promotionCodes.retrieve(promoCodeId);
    } catch (err) {
      console.error('[stripe-webhook] Could not retrieve promo code:', promoCodeId, err.message);
      continue;
    }

    // Only process friend referral codes
    if (promoCode.metadata?.type !== 'friend') continue;

    const friendCode = promoCode.code;
    const referrerEmail = promoCode.metadata.referrer_email;
    if (!referrerEmail) continue;

    // Look up the referral record in Supabase
    let referral;
    try {
      const res = await sbFetch(
        `/rest/v1/quiz_referrals?friend_code=eq.${encodeURIComponent(friendCode)}&select=*&limit=1`
      );
      const rows = await res.json();
      if (!rows || rows.length === 0) {
        console.log('[stripe-webhook] No referral found for friend_code:', friendCode);
        continue;
      }
      referral = rows[0];
    } catch (err) {
      console.error('[stripe-webhook] Supabase lookup error:', err.message);
      continue;
    }

    if (referral.referrer_rewarded) {
      console.log('[stripe-webhook] Referrer already rewarded for referral:', referral.id);
      continue;
    }

    // Create the referrer's promo code
    const expiryDate = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const expiresAt = Math.floor(expiryDate.getTime() / 1000);
    const suffix = Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

    let referrerPromo;
    try {
      referrerPromo = await stripe.promotionCodes.create({
        coupon: couponId,
        code: 'QUIZ-' + suffix + '-YOU',
        max_redemptions: 1,
        expires_at: expiresAt,
        restrictions: {
          minimum_amount: MIN_ORDER_CENTS,
          minimum_amount_currency: 'nzd',
        },
        metadata: {
          type: 'referrer',
          referrer_email: referrerEmail,
          friend_email: promoCode.metadata.friend_email || '',
          triggered_by: 'webhook',
        },
      });
    } catch (err) {
      console.error('[stripe-webhook] Failed to create referrer promo code:', err.message);
      continue;
    }

    const expiryFormatted = expiryDate.toLocaleDateString('en-NZ', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    // Email the referrer their reward
    sendEmail({
      to: referrerEmail,
      subject: 'Your friend ordered — here\'s your $5 off! — PrimalPantry',
      html: referrerRewardEmailHtml({ code: referrerPromo.code, expiryDate: expiryFormatted }),
    }).catch(err => console.error('[stripe-webhook] Email error:', err.message));

    // Mark referral as rewarded in Supabase
    try {
      await sbFetch(`/rest/v1/quiz_referrals?id=eq.${referral.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          referrer_code: referrerPromo.code,
          referrer_rewarded: true,
        },
      });
    } catch (err) {
      console.error('[stripe-webhook] Supabase update error:', err.message);
    }

    console.log(`[stripe-webhook] Referrer rewarded: ${referrerEmail} → ${referrerPromo.code}`);
  }

  return { statusCode: 200, body: 'OK' };
};
