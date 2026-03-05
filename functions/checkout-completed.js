/**
 * checkout-completed.js
 *
 * Env vars required in Netlify:
 *   STRIPE_SECRET_KEY             — NZ Stripe secret key (existing, no rename needed)
 *   STRIPE_SECRET_KEY_AU          — AU Stripe secret key (new)
 *   CHECKOUT_COMPLETED_SECRET     — NZ webhook signing secret (existing, no rename needed)
 *   CHECKOUT_COMPLETED_SECRET_AU  — AU webhook signing secret (new)
 *   FACEBOOK_ACCESS_TOKEN         — FB CAPI token (move out of hardcode)
 */

const crypto = require('crypto');
const FACEBOOK_PIXEL_ID = '809100344281173';

exports.handler = async (event, context) => {
  const fetch = (await import('node-fetch')).default;

  // Peek at the raw body to determine market BEFORE verification
  // so we can select the right webhook secret
  let rawMarket = 'NZ';
  try {
    const peeked = JSON.parse(event.body);
    rawMarket = peeked?.data?.object?.metadata?.market || 'NZ';
  } catch (_) {
    // body parse failed — default to NZ, verification will handle it
  }

  // Select webhook secret — fall back to NZ if AU not configured
  const webhookSecret = (rawMarket === 'AU' && process.env.CHECKOUT_COMPLETED_SECRET_AU)
    ? process.env.CHECKOUT_COMPLETED_SECRET_AU
    : process.env.CHECKOUT_COMPLETED_SECRET;

  if (!webhookSecret) {
    console.error('⚠️ Webhook secret not defined');
    return { statusCode: 500, body: 'Webhook secret not defined.' };
  }

  // Select Stripe instance — fall back to NZ if AU not configured
  const stripeKey = (rawMarket === 'AU' && process.env.STRIPE_SECRET_KEY_AU)
    ? process.env.STRIPE_SECRET_KEY_AU
    : process.env.STRIPE_SECRET_KEY;

  const stripe = require('stripe')(stripeKey);

  // Verify the webhook signature
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    console.log(`[webhook] Verified: ${stripeEvent.type} | Market: ${rawMarket}`);
  } catch (err) {
    console.error('⚠️ Webhook verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Handle checkout completion
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const market = session.metadata?.market || 'NZ';
    const customerEmail = session.customer_details?.email;

    if (customerEmail) {
      console.log(`[webhook] Purchase: ${customerEmail} | Market: ${market} | Amount: ${session.amount_total}`);
      await trackPurchase({
        email: customerEmail,
        amount_total: session.amount_total,
        currency: session.currency,
      });
    }
  }

  return { statusCode: 200, body: 'Webhook received.' };
};

/**
 * Send purchase event to Facebook Conversions API
 */
async function trackPurchase({ email, amount_total, currency }) {
  const fetch = (await import('node-fetch')).default;
  // Paste your existing Facebook access token here (the EAA... string from your old checkout-completed.js)
  const ACCESS_TOKEN = 'EAAU9shr9R4gBO2r17GFpgNP9LpZAvq8EUkpetaJG75ZAxOXnLZBZCtUfjcs0BnTu17leRfZATGUYmGppK1BrfIBP94BZBdCzb5yCTrj2tw2AeDiHPERBZBXZCuQJAln3JPCqviVlxPVbDXZBq0F8n45cPbjBZAYioouT8kDR7xSAjqwP3UoOwRIP8CWYRFTcoWZBWjvsfMyqOw1sARtudxqcLwrtY2XckSmyc4uwQZDZD';

  const hashedEmail = crypto
    .createHash('sha256')
    .update(email.toLowerCase())
    .digest('hex');

  const requestBody = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      user_data: {
        em: hashedEmail,
      },
      custom_data: {
        value: (amount_total / 100).toFixed(2),
        currency: currency.toUpperCase(),
      },
    }],
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${FACEBOOK_PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );
    const data = await response.json();
    if (!response.ok) console.error('[webhook] FB CAPI error:', data);
    else console.log('[webhook] FB CAPI success:', data);
  } catch (err) {
    console.error('[webhook] FB CAPI exception:', err);
  }
}
