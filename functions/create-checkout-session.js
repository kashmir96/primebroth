/**
 * create-checkout-session.js
 *
 * Env vars required in Netlify:
 *   STRIPE_SECRET_KEY      — NZ Stripe secret key (existing, no rename needed)
 *   STRIPE_SECRET_KEY_AU   — AU Stripe secret key (new)
 *   SUPABASE_URL           — Supabase project URL (for visitor_hash salt)
 *   SUPABASE_SERVICE_KEY   — Supabase service_role key
 */

const crypto = require('crypto');

const getStripe = (market) => {
  if (market === 'AU') {
    const auKey = process.env.STRIPE_SECRET_KEY_AU;
    if (!auKey) {
      console.warn('[checkout] STRIPE_SECRET_KEY_AU not set, falling back to NZ');
      return require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
    return require('stripe')(auKey);
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
};

exports.handler = async (event, context) => {
  // Keep-warm ping — return fast without touching Stripe
  if (event.httpMethod === 'GET' || (event.body && event.body === '{"warmup":true}')) {
    return { statusCode: 200, body: '{"warm":true}' };
  }

  try {
    const { cart, countryCode, osoMeta, clientInfo, quizBundle, giftCode } = JSON.parse(event.body);

    // Generate visitor_hash for analytics journey linking
    let visitorHash = '';
    try {
      const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '';
      const ua = event.headers['user-agent'] || '';
      const siteId = 'PrimalPantry.co.nz';
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
      if (supabaseUrl && supabaseKey && ip) {
        const saltRes = await fetch(`${supabaseUrl}/rest/v1/analytics_salt?id=eq.1&select=salt`, {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        });
        const saltRows = await saltRes.json();
        if (saltRows && saltRows[0]) {
          visitorHash = crypto.createHash('sha256').update(ip + ua + siteId + saltRows[0].salt).digest('hex');
        }
      }
    } catch (e) { console.warn('[checkout] visitor_hash generation failed:', e.message); }

    // Only activate AU if the AU Stripe key is actually configured
    const market = (countryCode === 'AU' && process.env.STRIPE_SECRET_KEY_AU)
      ? 'AU'
      : 'NZ';

    const stripe = getStripe(market);

    // Validate cart
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      throw new Error('Cart is empty or not provided.');
    }
    for (const item of cart) {
      if (!item.priceId || typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw new Error(`Invalid cart item: ${JSON.stringify(item)}`);
      }
    }

    // Landing URL from cookie (for thank-you page attribution)
    const landingURL = event.headers.cookie
      ?.split(';')
      .find(c => c.trim().startsWith('landingURL='))
      ?.split('=')[1];
    const decodedLandingURL = decodeURIComponent(landingURL || '');

    // Build line items and total
    const lineItems = [];
    let totalAmount = 0;

    for (const item of cart) {
      try {
        console.log(`[${market}] Retrieving price: ${item.priceId}`);
        let price;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            price = await stripe.prices.retrieve(item.priceId);
            break;
          } catch (retryErr) {
            // Retry once on connection errors (ECONNRESET, ETIMEDOUT, etc.)
            if (attempt === 0 && retryErr.type === 'StripeConnectionError') {
              console.log(`[${market}] Stripe connection error on ${item.priceId}, retrying...`);
              await new Promise(r => setTimeout(r, 500));
              continue;
            }
            throw retryErr;
          }
        }

        if (!price || price.unit_amount == null) {
          throw new Error(`Invalid price for priceId: ${item.priceId}`);
        }

        lineItems.push({ price: item.priceId, quantity: item.quantity });
        totalAmount += item.quantity * price.unit_amount;
      } catch (priceError) {
        console.error(`[${market}] Error on priceId ${item.priceId}:`, priceError);
        const err = new Error(`Failed to process item: ${priceError.message}`);
        err.stripeCode = priceError.code || priceError.decline_code || '';
        err.stripeType = priceError.type || '';
        err.stripeStatus = priceError.statusCode || '';
        throw err;
      }
    }

    console.log(`[${market}] Total: ${totalAmount} cents`);

    // ── Shipping options ─────────────────────────────────────────────────────
    let shippingOptions = [];
    let payment_method_types = [];

    if (market === 'NZ') {
      payment_method_types = ['card', 'afterpay_clearpay'];
      shippingOptions = totalAmount >= 8000
        ? [{ shipping_rate: 'shr_1RNoN3FZRwx5tlYmUStQxW5y' }]           // free NZ ($80+)
        : [
            { shipping_rate: 'shr_1RNoLQFZRwx5tlYmbtbV28PB' },           // standard NZ
            { shipping_rate: 'shr_1RNoR5FZRwx5tlYmxFgyFs06' },           // rural NZ
          ];
    } else {
      payment_method_types = ['card'];
      shippingOptions = totalAmount >= 15000
        ? [{ shipping_rate: 'shr_1T7S8WJzNO9WRf4JEZCFS42D' }]           // free AU ($150+)
        : [{ shipping_rate: 'shr_1T7S91JzNO9WRf4JjAvxwbaj' }];          // standard AU
    }

    // ── Return URL (embedded checkout uses return_url instead of success/cancel) ──
    const baseURL = 'https://www.primalpantry.co.nz';
    const returnUrl = `${baseURL}/pages/thank-you?session_id={CHECKOUT_SESSION_ID}&landing_url=${encodeURIComponent(decodedLandingURL)}&market=${market}`;

    // ── Resolve gift promo code ID (NZ only) ──
    let giftPromoId = null;
    if (giftCode && market === 'NZ') {
      try {
        const promos = await stripe.promotionCodes.list({ code: giftCode, active: true, limit: 1 });
        if (promos.data.length > 0) giftPromoId = promos.data[0].id;
        else console.warn('[checkout] gift code not found or inactive:', giftCode);
      } catch (e) {
        console.error('[checkout] gift promo lookup failed:', e.message);
      }
    }

    // ── Create session (embedded mode) ──────────────────────────────────────
    const sessionParams = {
      payment_method_types,
      shipping_address_collection: { allowed_countries: [market] },
      shipping_options: shippingOptions,
      line_items: lineItems,
      mode: 'payment',
      ui_mode: 'embedded',
      return_url: returnUrl,
      metadata: {
        market,
        ...(quizBundle ? { quiz_bundle: 'true' } : {}),
        ...(giftCode && giftPromoId ? { gift_code: giftCode } : {}),
        ...(visitorHash ? { visitor_hash: visitorHash } : {}),
        ...(osoMeta ? {
          oso_lp: osoMeta.landing_page || '',
          oso_src: osoMeta.analytics_source || '',
          oso_magnet: osoMeta.magnet_product || '',
          oso_last_product: osoMeta.last_product_page || '',
        } : {}),
        ...(clientInfo ? {
          client_browser: clientInfo.browser || '',
          client_device: clientInfo.device || '',
          client_os: clientInfo.os || '',
          client_screen: String(clientInfo.screenWidth || 0),
        } : {}),
      },
    };

    // Try with gift discount first — if Stripe rejects it (expired/used/invalid),
    // fall back gracefully to allow_promotion_codes so checkout always loads.
    let session;
    if (giftPromoId) {
      try {
        session = await stripe.checkout.sessions.create({
          ...sessionParams,
          discounts: [{ promotion_code: giftPromoId }],
        });
        console.log(`[${market}] Session created with gift discount: ${session.id}`);
      } catch (discountErr) {
        console.warn(`[${market}] Gift promo rejected (${discountErr.message}) — retrying without discount`);
        session = await stripe.checkout.sessions.create({
          ...sessionParams,
          allow_promotion_codes: true,
        });
        console.log(`[${market}] Session created (fallback, no discount): ${session.id}`);
      }
    } else {
      session = await stripe.checkout.sessions.create({
        ...sessionParams,
        allow_promotion_codes: true,
      });
      console.log(`[${market}] Session created: ${session.id}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ clientSecret: session.client_secret }),
    };

  } catch (error) {
    console.error('Error creating checkout session:', error.message);

    // Detect card declines vs real integration errors
    const declineCodes = [
      'card_declined', 'insufficient_funds', 'expired_card', 'incorrect_cvc',
      'authentication_required', 'processing_error', 'do_not_honor',
      'lost_card', 'stolen_card', 'generic_decline', 'fraudulent',
    ];
    const errLower = (error.message + ' ' + (error.stripeCode || '') + ' ' + (error.stripeType || '')).toLowerCase();
    const isCardDecline = declineCodes.some(p => errLower.includes(p))
      || (error.stripeType === 'StripeCardError');

    // Log ALL errors to Supabase (card declines + integration errors)
    try {
      const sbUrl = process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_KEY;
      if (sbUrl && sbKey) {
        let parsedBody = {};
        try { parsedBody = JSON.parse(event.body || '{}'); } catch {}
        const ci = parsedBody.clientInfo || {};
        const ua = event.headers['user-agent'] || '';
        await fetch(`${sbUrl}/rest/v1/checkout_errors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` },
          body: JSON.stringify({
            error_message: error.message,
            error_code: error.stripeCode || '',
            error_type: error.stripeType || '',
            cart: JSON.stringify((parsedBody.cart || []).map(i => ({ qty: i.quantity, id: i.priceId }))),
            browser: ci.browser || '',
            device: ci.device || '',
            os: ci.os || '',
            screen_width: ci.screenWidth || 0,
            country: parsedBody.countryCode || '',
            user_agent: ua,
            is_card_decline: isCardDecline,
          }),
        }).catch(() => {});
      }
    } catch {}

    if (!isCardDecline) {
      try {
        const SID = process.env.TWILIO_SID;
        const TOKEN = process.env.TWILIO_API;
        const FROM = process.env.TWILIO_FROM_NUMBER;
        const numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

        if (SID && TOKEN && FROM && numbers.length) {
          let cartSummary = 'unknown';
          try { cartSummary = (JSON.parse(event.body || '{}').cart || []).map(i => `${i.quantity}x ${i.priceId}`).join(', ') || 'unknown'; } catch {}
          const msg = `PP checkout fail: ${error.message}\nCart: ${cartSummary}`;

          const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
          for (const to of numbers) {
            await Promise.race([
              fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ From: FROM, To: to, Body: msg }).toString(),
              }),
              timeout(5000),
            ]).catch(() => {});
          }
        }
      } catch (smsErr) {
        console.error('SMS alert failed:', smsErr.message);
      }
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Error creating checkout session: ${error.message}` }),
    };
  }
};
