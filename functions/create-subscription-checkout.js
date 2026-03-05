/**
 * create-subscription-session.js
 *
 * Env vars required in Netlify:
 *   STRIPE_SECRET_KEY      — NZ Stripe secret key (existing, no rename needed)
 *   STRIPE_SECRET_KEY_AU   — AU Stripe secret key (new)
 */

const getStripe = (market) => {
  if (market === 'AU') {
    const auKey = process.env.STRIPE_SECRET_KEY_AU;
    if (!auKey) {
      console.warn('[subscription] STRIPE_SECRET_KEY_AU not set, falling back to NZ');
      return require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
    return require('stripe')(auKey);
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
};

exports.handler = async (event, context) => {
  try {
    const { cart, countryCode } = JSON.parse(event.body);

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

    const lineItems = cart.map(item => ({
      price: item.priceId,
      quantity: item.quantity,
    }));

    console.log(`[${market}] Subscription line items:`, JSON.stringify(lineItems));

    // Landing URL from cookie
    const landingURL = event.headers.cookie
      ?.split(';')
      .find(c => c.trim().startsWith('landingURL='))
      ?.split('=')[1];
    const decodedLandingURL = decodeURIComponent(landingURL || '');

    const baseURL = 'https://www.primalpantry.co.nz';
    const successUrl = `${baseURL}/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}&type=subscription&market=${market}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: [market],
      },
      line_items: lineItems,
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: `${baseURL}/subscribe/`,
      metadata: { market },
    });

    console.log(`[${market}] Subscription session created: ${session.id}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id, url: session.url }),
    };

  } catch (error) {
    console.error('Error creating subscription session:', error.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Error creating subscription checkout: ${error.message}` }),
    };
  }
};
