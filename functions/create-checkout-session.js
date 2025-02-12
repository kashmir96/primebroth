const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    const { cart } = JSON.parse(event.body);

    // Check if the cart is valid
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      throw new Error('Cart is empty or not provided.');
    }

    // Retrieve the landing URL from cookies (sent from frontend)
    const landingURL = event.headers.cookie
      .split(';')
      .find(cookie => cookie.trim().startsWith('landingURL='))
      ?.split('=')[1];

    // Decode URL-encoded string
    const decodedLandingURL = decodeURIComponent(landingURL || '');

    const lineItems = [];
    let totalAmount = 0;

    // Process each cart item to create line items
    for (const item of cart) {
      try {
        if (!item.priceId || typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error(`Invalid cart item: Missing or incorrect priceId or quantity for item: ${JSON.stringify(item)}`);
        }

        console.log(`Retrieving price for priceId: ${item.priceId}`);

        // Retrieve the price from Stripe
        const price = await stripe.prices.retrieve(item.priceId);

        if (!price || !price.unit_amount) {
          throw new Error(`Invalid price retrieved for priceId: ${item.priceId}`);
        }

        console.log(`Price retrieved: ${price.unit_amount} cents, Quantity: ${item.quantity}`);

        lineItems.push({
          price: item.priceId,
          quantity: item.quantity,
        });

        totalAmount += item.quantity * price.unit_amount;
      } catch (priceError) {
        console.error(`Error processing cart item with priceId: ${item.priceId}`, priceError);
        throw new Error(`Failed to process item in cart: ${priceError.message}`);
      }
    }

    console.log(`Total amount in cents: ${totalAmount}`);
    
    // Define shipping rates for NZ & AU
    const shippingRates = {
      NZ: {
        standard: 'shr_1QKTanFZRwx5tlYmmr0UUDQw',
        medium: 'shr_1QKTanFZRwx5tlYmmr0UUDQw',
        free: 'shr_1QKTagFZRwx5tlYmswF6jANR',
        rural: 'shr_1QKTajFZRwx5tlYmayPCyClE',
      },
      AU: {
        standard: 'shr_1QrGJiFZRwx5tlYmTxZEcVkE',
        free: 'shr_1QKTagFZRwx5tlYmswF6jANR', // Use same free shipping as NZ
      },
    };

    // Function to determine shipping options based on country
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

    console.log(`Shipping rates loaded for NZ & AU.`);

    // Create success URL with landingURL as a query parameter
    const successUrl = `https://www.primalpantry.co.nz/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}`;

    // Create a Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['NZ', 'AU'], // Allow NZ & AU
      },
      shipping_options: [], // Empty initially, will be updated dynamically
      line_items: lineItems,
      mode: 'payment',

      // Apply discount if eligible
      discounts: cart.some(item => item.eligibleForDiscount)
        ? [{ promotion_code: 'promo_1QbZRXFZRwx5tlYmV6Zc83ot' }]
        : [],

      success_url: successUrl,
      cancel_url: 'https://www.primalpantry.co.nz/cart/',
    });

    console.log(`Checkout session created successfully with ID: ${session.id}`);

    // Update shipping options dynamically based on country selection
    session.shipping_options = getShippingOptions(session.shipping_address_collection.allowed_countries[0]);

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
