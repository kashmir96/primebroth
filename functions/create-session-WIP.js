const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    const { cart, country } = JSON.parse(event.body); // Accept country from frontend

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
        // Validate each item in the cart
        if (!item.priceId || typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error(`Invalid cart item: Missing or incorrect priceId or quantity for item: ${JSON.stringify(item)}`);
        }

        console.log(`Retrieving price for priceId: ${item.priceId}`);

        // Retrieve the price from Stripe
        const price = await stripe.prices.retrieve(item.priceId);

        // Validate retrieved price
        if (!price || !price.unit_amount) {
          throw new Error(`Invalid price retrieved for priceId: ${item.priceId}`);
        }

        console.log(`Price retrieved: ${price.unit_amount} cents, Quantity: ${item.quantity}`);

        // Create line item for Stripe Checkout
        lineItems.push({
          price: item.priceId,
          quantity: item.quantity,
        });

        // Accumulate the total amount
        totalAmount += item.quantity * price.unit_amount;
      } catch (priceError) {
        console.error(`Error processing cart item with priceId: ${item.priceId}`, priceError);
        throw new Error(`Failed to process item in cart: ${priceError.message}`);
      }
    }

    // Log the total amount for debugging
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
        standard: 'shr_1QrGJiFZRwx5tlYmTxZEcVkE', // New AU shipping rate
      },
    };

    // Determine shipping country (default to NZ)
    const selectedCountry = country && shippingRates[country] ? country : 'NZ';
    console.log(`Shipping country detected: ${selectedCountry}`);

    let shippingOptions = [];

    if (selectedCountry === 'NZ') {
      if (totalAmount >= 8000) {
        shippingOptions = [{ shipping_rate: shippingRates.NZ.free }];
      } else if (totalAmount >= 1000) {
        shippingOptions = [
          { shipping_rate: shippingRates.NZ.medium },
          { shipping_rate: shippingRates.NZ.rural },
        ];
      } else {
        shippingOptions = [
          { shipping_rate: shippingRates.NZ.standard },
          { shipping_rate: shippingRates.NZ.rural },
        ];
      }
    } else if (selectedCountry === 'AU') {
      shippingOptions = [{ shipping_rate: shippingRates.AU.standard }];
    }

    console.log(`Shipping options: ${JSON.stringify(shippingOptions)}`);

    // Create success URL with landingURL as a query parameter
    const successUrl = `https://www.primalpantry.co.nz/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}`;

    // Create a Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['NZ', 'AU'], // Now allows both New Zealand & Australia
      },
      shipping_options: shippingOptions,
      line_items: lineItems,
      mode: 'payment',

      // Dynamically apply the discount if any item is eligible
      discounts: cart.some(item => item.eligibleForDiscount)
        ? [{ promotion_code: 'promo_1QbZRXFZRwx5tlYmV6Zc83ot' }]
        : [],

      success_url: successUrl,
      cancel_url: 'https://www.primalpantry.co.nz/cart/',
    });

    console.log(`Checkout session created successfully with ID: ${session.id}`);

    // Return session ID to frontend
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
