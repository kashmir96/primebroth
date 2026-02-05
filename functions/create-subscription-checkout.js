const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    const { cart, countryCode } = JSON.parse(event.body);

    // Validate cart
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      throw new Error('Cart is empty or not provided.');
    }

    // Validate all items have recurring price IDs
    for (const item of cart) {
      if (!item.priceId || typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw new Error(`Invalid cart item: ${JSON.stringify(item)}`);
      }
    }

    // Build line items
    const lineItems = cart.map(item => ({
      price: item.priceId,
      quantity: item.quantity,
    }));

    console.log('Subscription line items:', JSON.stringify(lineItems));

    // Retrieve landing URL from cookies
    const landingURL = event.headers.cookie
      ?.split(';')
      .find(cookie => cookie.trim().startsWith('landingURL='))
      ?.split('=')[1];
    const decodedLandingURL = decodeURIComponent(landingURL || '');

    const successUrl = `https://www.primalpantry.co.nz/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}&type=subscription`;

    // Create Stripe Checkout Session in subscription mode
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['NZ'],
      },
      line_items: lineItems,
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: 'https://www.primalpantry.co.nz/subscribe/tallow-skin/',
    });

    console.log(`Subscription checkout session created: ${session.id}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    console.error('Error creating subscription checkout session:', error.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Error creating subscription checkout: ${error.message}` }),
    };
  }
};
