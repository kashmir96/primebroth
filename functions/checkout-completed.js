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
 *   STARSHIPIT_API_KEY            — StarshipIt / eShip API key
 *   STARSHIPIT_SUBSCRIPTION_KEY   — StarshipIt / eShip subscription key
 *   SUPABASE_URL                  — Supabase project URL
 *   SUPABASE_SERVICE_KEY          — Supabase service_role secret key
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

      // Retrieve the full session with line items (retry once on ECONNRESET)
      let fullSession;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          fullSession = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ['line_items', 'line_items.data.price.product'],
          });
          break;
        } catch (err) {
          if (attempt === 0 && err.code === 'ECONNRESET') {
            console.log('[webhook] Stripe ECONNRESET — retrying...');
            continue;
          }
          throw err;
        }
      }

      // Run FB CAPI and Airtable in parallel — fire-and-forget so failures
      // never prevent Stripe from receiving the 200 OK
      await Promise.allSettled([
        trackPurchase({
          email: customerEmail,
          amount_total: session.amount_total,
          currency: session.currency,
        }),
        addToAirtable({ session: fullSession, market, fetch }),
        pushToEship({ session: fullSession, market, fetch }),
        addToSupabase({ session: fullSession, market, fetch }),
        saveOsoMeta(fullSession, fetch),
      ]).then(results => {
        const labels = ['FB CAPI', 'Airtable', 'eShip', 'Supabase', 'Oso Meta'];
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error(`[webhook] ${labels[i]} failed:`, r.reason);
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
    'Shipping':             String((session.total_details?.amount_shipping || 0) / 100),
    'Discount Applied':     String((session.total_details?.amount_discount || 0) / 100),
    'Value':                (session.amount_total || 0) / 100,
    'Sale Collected by':    'Website',
    'Stripe Order ID':      session.id,
    'Name':                 shipping?.name || session.customer_details?.name || '',
    'Street Address':       address.line1 || '',
    'Suburb':               address.line2 || '',
    'State':                address.city || '',
    'Country Code':         address.country || market,
    'Postcode':             address.postal_code || '',
    'Thank-you URL':        (session.success_url || session.return_url || '').replace('{CHECKOUT_SESSION_ID}', session.id),
    'Currency':             (session.currency || '').toUpperCase(),
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
      'Units sold':         String(li.quantity),
      'Unit price':         String((li.amount_total || 0) / 100),
      'Description':        li.price?.product?.name || li.description || '',
      'SKU':                li.price?.nickname || '',
      'Sale Line Item ID':  li.id,
      'Order ID':           [orderRecordId], // Linked record field
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
 * Push order to eShip (NZ Post / StarshipIt) for label printing
 */
async function pushToEship({ session, market, fetch }) {
  // Only push NZ domestic orders
  if (market !== 'NZ') {
    console.log('[webhook] eShip skipped — non-NZ order');
    return;
  }

  const apiKey = process.env.STARSHIPIT_API_KEY;
  const subscriptionKey = process.env.STARSHIPIT_SUBSCRIPTION_KEY;

  if (!apiKey || !subscriptionKey) {
    console.error('[webhook] eShip env vars missing — skipping');
    return;
  }

  const shipping = session.shipping_details || session.customer_details;
  const address = shipping?.address || {};
  const lineItems = session.line_items?.data || [];

  // ── Compute jar counts, goods desc, weight, size from SKUs ──
  let totalJars = 0;
  const goodsDescParts = [];
  const items = [];

  for (const li of lineItems) {
    const sku = li.price?.nickname || li.price?.product?.name || '';
    const qty = li.quantity;
    const skuLower = sku.toLowerCase();

    // Jar multiplier per unit — determines bag size
    // DL (≤3 jars), A5 (4-6), A4 (7-9), A3 (>9)
    let jarsPerUnit = 1;
    if (skuLower.includes('60ml') || skuLower.includes('lip')) {
      jarsPerUnit = 0.5;
    } else if (skuLower.includes('scalp-bundle') || skuLower.includes('black') || skuLower.includes('250') || skuLower.includes('sensitive-skin-kit')) {
      jarsPerUnit = 9;
    } else if (skuLower.includes('anti-aging') || skuLower.includes('shampoo-bottle') || skuLower.includes('conditioner')) {
      jarsPerUnit = 6;
    } else if (skuLower.includes('lotion') || skuLower.includes('liqsoap') || skuLower.includes('liquid-bundle')) {
      jarsPerUnit = 4;
    } else if (skuLower.includes('vitallow')) {
      jarsPerUnit = 3;
    } else if (skuLower.includes('200ml') || skuLower.includes('powder') || skuLower.includes('cleanser')) {
      jarsPerUnit = 2;
    }

    // Pack multiplier (e.g. -3pk, trio)
    let packMultiplier = 1;
    if (skuLower.includes('-3pk') || skuLower.includes('trio')) {
      packMultiplier = 3;
    }

    const unitJars = jarsPerUnit * packMultiplier;
    totalJars += unitJars * qty;

    // Goods desc: "1 x balm-cacao" (strip Olive/Jojoba like Airtable formula)
    const cleanSku = sku.replace(/Olive/gi, '').replace(/Jojoba/gi, '').trim();
    goodsDescParts.push(`${qty} x ${cleanSku}`);

    items.push({
      description: li.price?.product?.name || li.description || sku,
      sku: sku,
      quantity: qty,
      weight: Math.ceil((unitJars * qty * 0.2) * 2) / 2,
      value: (li.amount_total || 0) / 100,
      country_of_origin: 'New Zealand',
    });
  }

  // Weight: round up to nearest 0.5kg
  const weight = Math.ceil((totalJars * 0.2) * 2) / 2;

  // Size based on jar count
  let size, carrierProduct;
  if (totalJars > 9) {
    size = 'L'; carrierProduct = 'CPOLTPA3';
  } else if (totalJars > 6) {
    size = 'M'; carrierProduct = 'CPOLTPA4';
  } else if (totalJars > 3) {
    size = 'S'; carrierProduct = 'CPOLTPA5';
  } else {
    size = 'XS'; carrierProduct = 'CPOLTPDL';
  }

  const goodsDesc = goodsDescParts.join(', ');

  const orderBody = {
    order: {
      order_number: session.id,
      order_date: new Date().toISOString(),
      reference: goodsDesc,
      shipping_method: carrierProduct,
      carrier_service_code: carrierProduct,
      carrier: 'CourierPost',
      signature_required: false,
      authority_to_leave: true,
      currency: 'NZD',
      destination: {
        name: shipping?.name || session.customer_details?.name || '',
        email: session.customer_details?.email || '',
        phone: session.customer_details?.phone || '',
        street: address.line1 || '',
        suburb: address.line2 || '',
        city: address.city || '',
        state: address.state || '',
        post_code: address.postal_code || '',
        country: 'New Zealand',
        delivery_instructions: goodsDesc,
      },
      items,
      packages: [{
        weight,
        height: 0.13,
        width: 0.13,
        length: 0.24,
      }],
    },
  };

  try {
    const response = await fetch('https://api.starshipit.com/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'StarShipIT-Api-Key': apiKey,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
      body: JSON.stringify(orderBody),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[webhook] eShip error:', JSON.stringify(data));
    } else {
      console.log('[webhook] eShip success:', data.order?.order_id || JSON.stringify(data));
    }
  } catch (err) {
    console.error('[webhook] eShip exception:', err);
  }
}

/**
 * Store order in Supabase (Postgres) — future replacement for Airtable
 */
async function addToSupabase({ session, market, fetch }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[webhook] Supabase env vars missing — skipping');
    return;
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  const shipping = session.shipping_details || session.customer_details;
  const address = shipping?.address || {};

  // Parse UTM params from the landing_url embedded in the thank-you URL
  const thankYouUrl = (session.success_url || session.return_url || '').replace('{CHECKOUT_SESSION_ID}', session.id);
  let utmSource = '', utmMedium = '', utmCampaign = '', utmTerm = '', utmContent = '';
  try {
    const tyUrl = new URL(thankYouUrl);
    // UTMs live inside the landing_url param, not at the top level
    const landingUrl = tyUrl.searchParams.get('landing_url') || '';
    const urlObj = landingUrl ? new URL(landingUrl) : tyUrl;
    utmSource = urlObj.searchParams.get('utm_source') || '';
    utmMedium = urlObj.searchParams.get('utm_medium') || '';
    utmCampaign = urlObj.searchParams.get('utm_campaign') || '';
    utmTerm = urlObj.searchParams.get('utm_term') || '';
    utmContent = urlObj.searchParams.get('utm_content') || '';
  } catch (_) { /* invalid URL — skip */ }

  const now = new Date();
  // Use NZ time for order_date and order_hour (fallback to UTC if conversion fails)
  let nzDate, nzHour;
  try {
    const nzNow = new Date(now.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
    nzDate = `${nzNow.getFullYear()}-${String(nzNow.getMonth() + 1).padStart(2, '0')}-${String(nzNow.getDate()).padStart(2, '0')}`;
    nzHour = nzNow.getHours();
  } catch (_) {
    nzDate = now.toISOString().split('T')[0];
    nzHour = now.getUTCHours();
  }

  // Step 1: Insert the order
  const orderRow = {
    stripe_session_id: session.id,
    order_date: nzDate,
    order_hour: nzHour,
    status: 'Ordered - Paid',
    customer_name: session.customer_details?.name || '',
    email: session.customer_details?.email || '',
    phone: session.customer_details?.phone || '',
    payment_method: 'Stripe',
    shipping_cost: (session.total_details?.amount_shipping || 0) / 100,
    discount_applied: (session.total_details?.amount_discount || 0) / 100,
    total_value: (session.amount_total || 0) / 100,
    currency: (session.currency || 'nzd').toUpperCase(),
    market,
    street_address: address.line1 || '',
    suburb: address.line2 || '',
    city: address.city || '',
    postcode: address.postal_code || '',
    country_code: address.country || market,
    thank_you_url: thankYouUrl,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_term: utmTerm,
    utm_content: utmContent,
    client_browser: session.metadata?.client_browser || '',
    client_device: session.metadata?.client_device || '',
    client_os: session.metadata?.client_os || '',
    client_screen: parseInt(session.metadata?.client_screen || '0', 10) || 0,
    visitor_hash: session.metadata?.visitor_hash || null,
  };

  let orderId;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify(orderRow),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[webhook] Supabase order error:', JSON.stringify(data));
      return;
    }
    orderId = data[0]?.id;
    console.log('[webhook] Supabase order success:', orderId);
  } catch (err) {
    console.error('[webhook] Supabase order exception:', err);
    return;
  }

  // Step 2: Insert line items
  const lineItems = session.line_items?.data || [];
  if (lineItems.length === 0 || !orderId) return;

  const rows = lineItems.map(li => ({
    order_id: orderId,
    stripe_line_item_id: li.id,
    description: li.price?.product?.name || li.description || '',
    sku: li.price?.nickname || '',
    quantity: li.quantity,
    unit_price: (li.amount_total || 0) / 100,
  }));

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/order_line_items`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[webhook] Supabase line items error:', JSON.stringify(data));
    } else {
      console.log(`[webhook] Supabase line items success: ${data.length} rows`);
    }
  } catch (err) {
    console.error('[webhook] Supabase line items exception:', err);
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

/**
 * Persist Oso analytics attribution metadata to Supabase orders table
 */
async function saveOsoMeta(session, fetch) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const meta = session.metadata || {};
  const lp = meta.oso_lp;
  const src = meta.oso_src;
  const lastProduct = meta.oso_last_product;
  if (!lp && !src && !lastProduct) return;

  const patch = {};
  if (lp) patch.landing_page = lp;
  if (src) patch.analytics_source = src;
  if (lastProduct) patch.last_product_page = lastProduct;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?stripe_session_id=eq.${encodeURIComponent(session.id)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(patch),
      }
    );
    if (!res.ok) {
      const data = await res.json();
      console.error('[webhook] Oso meta PATCH error:', JSON.stringify(data));
    } else {
      console.log('[webhook] Oso meta saved for session:', session.id);
    }
  } catch (err) {
    console.error('[webhook] Oso meta exception:', err);
  }
}
