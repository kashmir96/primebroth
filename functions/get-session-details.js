/**
 * get-session-details.js
 *
 * Returns safe public fields from a Stripe checkout session
 * for display on the thank-you page.
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY     — NZ Stripe secret key
 *   STRIPE_SECRET_KEY_AU  — AU Stripe secret key
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { session_id, market } = event.queryStringParameters || {};

  if (!session_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing session_id' }) };
  }

  const stripeKey = (market === 'AU' && process.env.STRIPE_SECRET_KEY_AU)
    ? process.env.STRIPE_SECRET_KEY_AU
    : process.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  const stripe = require('stripe')(stripeKey);

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'line_items.data.price.product'],
    });

    const shipping = session.shipping_details || session.customer_details;
    const address = shipping?.address || {};

    const result = {
      customer_name: session.customer_details?.name || '',
      email: session.customer_details?.email || '',
      shipping_name: shipping?.name || session.customer_details?.name || '',
      address: {
        line1: address.line1 || '',
        line2: address.line2 || '',
        city: address.city || '',
        postal_code: address.postal_code || '',
        country: address.country || '',
      },
      line_items: (session.line_items?.data || []).map(li => ({
        name: li.price?.product?.name || li.description || '',
        sku: li.price?.nickname || '',
        quantity: li.quantity,
        amount: (li.amount_total || 0) / 100,
      })),
      amount_total: (session.amount_total || 0) / 100,
      currency: (session.currency || 'nzd').toUpperCase(),
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[get-session-details] Error:', err.message);
    return { statusCode: 400, headers, body: JSON.stringify({ error: err.message }) };
  }
};
