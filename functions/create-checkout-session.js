const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    const { cart } = JSON.parse(event.body);

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      throw new Error('Cart is empty or not provided.');
    }

    const landingURL = event.headers.cookie
      .split(';')
      .find(cookie => cookie.trim().startsWith('landingURL='))
      ?.split('=')[1];

    const decodedLandingURL = decodeURIComponent(landingURL || '');

    const lineItems = [];
    let totalAmount = 0;

    for (const item of cart) {
      try {
        if (!item.priceId || typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error(`Invalid cart item: ${JSON.stringify(item)}`);
        }

        console.log(`Retrieving price for priceId: ${item.priceId}`);
        const price = await stripe.prices.retrieve(item.priceId);

        if (!price || !price.unit_amount) {
          throw new Error(`Invalid price retrieved for priceId: ${item.priceId}`);
        }

        lineItems.push({
          price: item.priceId,
          quantity: item.quantity,
        });

        totalAmount += item.quantity * price.unit_amount;
      } catch (priceError) {
        console.error(`Error processing cart item: ${priceError.message}`);
        throw new Error(`Failed to process item: ${priceError.message}`);
      }
    }

    console.log(`Total amount: ${totalAmount} cents`);

    // Define all possible shipping rates (with updated AU rate)
    const shippingRates = {
      NZ: {
        standard: 'shr_1QKTanFZRwx5tlYmmr0UUDQw',
        medium: 'shr_1QKTanFZRwx5tlYmmr0UUDQw',
        rural: 'shr_1QKTajFZRwx5tlYmayPCyClE',
        free: 'shr_1QKTagFZRwx5tlYmswF6jANR',
      },
      AU: {
        standard: 'shr_1QreQWFZRwx5tlYmSp5RW0qz', // ✅ Updated AU shipping rate
        free: 'shr_1QKTagFZRwx5tlYmswF6jANR',
      },
    };

    let shippingOptions = [
      // NZ Shipping Options
      { shipping_rate: shippingRates.NZ.standard },
      { shipping_rate: shippingRates.NZ.rural },
      { shipping_rate: shippingRates.NZ.medium },
      { shipping_rate: shippingRates.NZ.free },

      // AU Shipping Options (with new shipping rate)
      { shipping_rate: shippingRates.AU.standard },
      { shipping_rate: shippingRates.AU.free },
    ];

    console.log(`Shipping rates applied: ${JSON.stringify(shippingOptions)}`);

    const successUrl = `https://www.primalpantry.co.nz/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['NZ', 'AU'], // Let Stripe collect the address
      },
      shipping_options: shippingOptions, // Send all rates; Stripe will filter them
      line_items: lineItems,
      mode: 'payment',

      discounts: cart.some(item => item.eligibleForDiscount)
        ? [{ promotion_code: 'promo_1QbZRXFZRwx5tlYmV6Zc83ot' }]
        : [],

      success_url: successUrl,
      cancel_url: 'https://www.primalpantry.co.nz/cart/',
    });

    console.log(`Checkout session created successfully with ID: ${session.id}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    console.error('Error creating checkout session:', error.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Error: ${error.message}` }),
    };
  }
};
