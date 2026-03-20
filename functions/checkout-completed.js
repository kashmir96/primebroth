/**
 * checkout-completed.js
 *
 * Env vars required in Netlify:
 *   STRIPE_SECRET_KEY             — NZ Stripe secret key (existing, no rename needed)
 *   STRIPE_SECRET_KEY_AU          — AU Stripe secret key (new)
 *   CHECKOUT_COMPLETED_SECRET     — NZ webhook signing secret (existing, no rename needed)
 *   CHECKOUT_COMPLETED_SECRET_AU  — AU webhook signing secret (new)
 *   FACEBOOK_ACCESS_TOKEN         — FB CAPI token (move out of hardcode)
 *   AIRTABLE_API_KEY              — Airtable Personal Access Token
 *   AIRTABLE_BASE_ID              — Airtable Base ID (e.g. appXXXXXXXXXXXXXX)
 *   AIRTABLE_TABLE_NAME           — Airtable table name (e.g. "Online / Market Sales")
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

      // Retrieve the full session with line items for Airtable
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items', 'line_items.data.price.product'],
      });

      // Run FB CAPI and Airtable in parallel — fire-and-forget so failures
      // never prevent Stripe from receiving the 200 OK
      await Promise.allSettled([
        trackPurchase({
          email: customerEmail,
          amount_total: session.amount_total,
          currency: session.currency,
        }),
        addToAirtable({ session: fullSession, market, fetch }),
      ]).then(results => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error(`[webhook] Task ${i} failed:`, r.reason);
          }
        });
      });
    }
  }

  return { statusCode: 200, body: 'Webhook received.' };
};

/**
 * Push order to Airtable — replaces the Zapier integration
 */
async function addToAirtable({ session, market, fetch }) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Online / Market Sales';
  const lineItemsTableName = 'Sale Line Items';

  if (!apiKey || !baseId) {
    console.error('[webhook] Airtable env vars missing — skipping');
    return;
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const shipping = session.shipping_details || session.customer_details;
  const address = shipping?.address || {};

  // Build line items summary: "2x Bone Broth, 1x Tallow Balm"
  const lineItemsSummary = (session.line_items?.data || [])
    .map(li => `${li.quantity}x ${li.price?.product?.name || li.description || 'Unknown'}`)
    .join(', ');

  const totalItems = (session.line_items?.data || [])
    .reduce((sum, li) => sum + li.quantity, 0);

  // ── Step 1: Create the order record in "Online / Market Sales" ──
  const orderFields = {
    'Contact':              session.customer_details?.name || '',
    'Order Date':           new Date().toISOString().split('T')[0],
    'Status':               'Ordered - Paid',
    'Email':                session.customer_details?.email || '',
    'Payment Method':       'Stripe',
    'Shipping':             (session.total_details?.amount_shipping || 0) / 100,
    'Discount Applied':     (session.total_details?.amount_discount || 0) / 100,
    'Value':                (session.amount_total || 0) / 100,
    'Sale Collected by':    'Website',
    'Stripe Order ID':      session.id,
    'Name':                 shipping?.name || session.customer_details?.name || '',
    'Street Address':       address.line1 || '',
    'Suburb':               address.line2 || '',
    'State':                address.city || '',
    'Country Code':         address.country || market,
    'Postcode':             address.postal_code || '',
    'Thank-you URL':        session.success_url || '',
    'Currency':             (session.currency || '').toUpperCase(),
    'Sale Line Items':      lineItemsSummary,
    'Total Items':          totalItems,
  };

  const orderUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  let orderRecordId = null;

  try {
    const response = await fetch(orderUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fields: orderFields }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[webhook] Airtable order error:', JSON.stringify(data));
      return; // Don't create line items if order failed
    }
    orderRecordId = data.id;
    console.log('[webhook] Airtable order success:', orderRecordId);
  } catch (err) {
    console.error('[webhook] Airtable order exception:', err);
    return;
  }

  // ── Step 2: Create a row per line item in "Sale Line Items" ──
  const lineItems = session.line_items?.data || [];
  if (lineItems.length === 0) return;

  const lineItemsUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(lineItemsTableName)}`;

  // Airtable batch API accepts up to 10 records at a time
  const records = lineItems.map(li => ({
    fields: {
      'Units sold':         li.quantity,
      'Unit price':         (li.amount_total || 0) / 100,
      'Description':        li.price?.product?.name || li.description || '',
      'SKU':                li.price?.nickname || '',
      'Sale Line Item ID':  li.id,
      'OrderID New':        [orderRecordId], // Linked record field
      'Stripe Order ID':    session.id,
    },
  }));

  // Batch in groups of 10 (Airtable limit)
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    try {
      const response = await fetch(lineItemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: batch }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('[webhook] Airtable line items error:', JSON.stringify(data));
      } else {
        console.log(`[webhook] Airtable line items success: ${data.records.length} rows`);
      }
    } catch (err) {
      console.error('[webhook] Airtable line items exception:', err);
    }
  }
}

/**
 * Send purchase event to Facebook Conversions API
 */
async function trackPurchase({ email, amount_total, currency }) {
  const fetch = (await import('node-fetch')).default;
  const ACCESS_TOKEN = 'EAALoG9CF1ZCYBQy2XRb1vtnFt41kUsKKzd0nQuhKnbEOqJSb1mPyub47ZAoHlEqOQuG7NgOPSRaD0ybTkMbOyNOSu29AIUP5tNBnLN3xqt1rFevpRdsWvY0Q5VT7NGKumeSZC4ZANi84OaF4HmEQFTfZAVOZCNAxZCd6J51fSaS9y8CLG0OlVJtDiz3NcyP0CGZC1wZDZD';

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
