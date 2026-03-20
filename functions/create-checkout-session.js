/**
 * create-checkout-session.js
 *
 * Env vars required in Netlify:
 *   STRIPE_SECRET_KEY      — NZ Stripe secret key (existing, no rename needed)
 *   STRIPE_SECRET_KEY_AU   — AU Stripe secret key (new)
 */

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
  try {
    const { cart, countryCode, osoMeta } = JSON.parse(event.body);

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
        const price = await stripe.prices.retrieve(item.priceId);

        if (!price || price.unit_amount == null) {
          throw new Error(`Invalid price for priceId: ${item.priceId}`);
        }

        lineItems.push({ price: item.priceId, quantity: item.quantity });
        totalAmount += item.quantity * price.unit_amount;
      } catch (priceError) {
        console.error(`[${market}] Error on priceId ${item.priceId}:`, priceError);
        throw new Error(`Failed to process item: ${priceError.message}`);
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

    // ── URLs ─────────────────────────────────────────────────────────────────
    const baseURL = 'https://www.primalpantry.co.nz';
    const successUrl = `${baseURL}/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}&market=${market}`;
    const cancelUrl = `${baseURL}/cart/`;

    // ── Create session ────────────────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      payment_method_types,
      shipping_address_collection: {
        allowed_countries: [market],
      },
      shipping_options: shippingOptions,
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        market, // passed to webhook so it knows which Stripe account fired
        ...(osoMeta ? {
          oso_lp: osoMeta.landing_page || '',
          oso_src: osoMeta.analytics_source || '',
          oso_magnet: osoMeta.magnet_product || '',
          oso_last_product: osoMeta.last_product_page || '',
        } : {}),
      },
    });

    console.log(`[${market}] Session created: ${session.id}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };

  } catch (error) {
    console.error('Error creating checkout session:', error.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Error creating checkout session: ${error.message}` }),
    };
  }
};
