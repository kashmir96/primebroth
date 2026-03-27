/**
 * create-upsell-session.js
 *
 * Creates a Stripe embedded checkout session for a post-purchase upsell.
 * Called from the thank-you page when the customer clicks "Add to my order".
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY      — NZ Stripe secret key
 *   STRIPE_SECRET_KEY_AU   — AU Stripe secret key
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { price_id, market = 'NZ', original_session_id } = body;

  if (!price_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing price_id' }) };
  }

  const stripeKey = (market === 'AU' && process.env.STRIPE_SECRET_KEY_AU)
    ? process.env.STRIPE_SECRET_KEY_AU
    : process.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  const stripe = require('stripe')(stripeKey);

  // Pre-fill customer email if we can retrieve it from the original session
  let customerEmail;
  if (original_session_id) {
    try {
      const orig = await stripe.checkout.sessions.retrieve(original_session_id);
      customerEmail = orig.customer_details?.email;
    } catch (_) { /* non-fatal */ }
  }

  const baseURL = 'https://www.primalpantry.co.nz';

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      mode: 'payment',
      ui_mode: 'embedded',
      return_url: `${baseURL}/pages/thank-you?upsell=success&session_id=${original_session_id || ''}`,
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      metadata: {
        market,
        upsell: 'true',
        original_session_id: original_session_id || '',
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret: session.client_secret }),
    };
  } catch (err) {
    console.error('[create-upsell-session] Error:', err.message);
    return { statusCode: 400, headers, body: JSON.stringify({ error: err.message }) };
  }
};
