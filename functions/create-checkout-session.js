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

    const shippingRates = {
      NZ: {
        standard: 'shr_1QKTanFZRwx5tlYmmr0UUDQw',
        medium: 'shr_1QKTanFZRwx5tlYmmr0UUDQw',
        rural: 'shr_1QKTajFZRwx5tlYmayPCyClE',
        free: 'shr_1QKTagFZRwx5tlYmswF6jANR',
      },
      AU: {
        standard: 'shr_1QrGJiFZRwx5tlYmTxZEcVkE',
        free: 'shr_1QKTagFZRwx5tlYmswF6jANR',
      },
    };

    let shippingOptions = [];

    // Dynamically apply shipping rates based on the detected country
    const getShippingOptions = (country) => {
      let options = [];

      if (country === 'AU') {
        options.push({ shipping_rate: shippingRates.AU.standard });
        if (totalAmount >= 8000) {
          options.push({ shipping_rate: shippingRates.AU.free });
        }
      } else if (country === 'NZ') {
        options.push(
          { shipping_rate: shippingRates.NZ.standard },
          { shipping_rate: shippingRates.NZ.rural }
        );

        if (totalAmount >= 1000) {
          options.push({ shipping_rate: shippingRates.NZ.medium });
        }
        if (totalAmount >= 8000) {
          options.push({ shipping_rate: shippingRates.NZ.free });
        }
      }

      return options;
    };

    console.log(`Shipping rates loaded:`, JSON.stringify(shippingOptions));

    const successUrl = `https://www.primalpantry.co.nz/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['NZ', 'AU'],
      },
      shipping_options: getShippingOptions('NZ'), // Default to NZ, but Stripe will filter based on address
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
