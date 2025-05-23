const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    const { cart, countryCode } = JSON.parse(event.body);
    // const encodedCartData = encodeURIComponent(JSON.stringify(cart));

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
    
    // Determine the shipping rate based on the total amount
    const standardShippingRate = 'shr_1RNoLQFZRwx5tlYmbtbV28PB';
    const mediumShippingRate = 'shr_1QKTanFZRwx5tlYmmr0UUDQw';
    const freeShippingRate = 'shr_1RNoN3FZRwx5tlYmUStQxW5y';
    const ruralShippingRate = 'shr_1RNoR5FZRwx5tlYmxFgyFs06'; // Replace with your actual rural shipping rate ID
    const standardShippingRateAU = 'shr_1QreQWFZRwx5tlYmSp5RW0qz';
    const freeShippingRateAU = 'shr_1QxGdxFZRwx5tlYmATptVQyM';

    let shippingOptions = [];
    let payment_method_types = [];

    if(countryCode == 'NZ')
    {
      payment_method_types = ['card',  'afterpay_clearpay'];

      if (totalAmount >= 8000) {
        shippingOptions = [
          {
            shipping_rate: freeShippingRate,
          },
        ];
      } else {
        // Show both standard and rural shipping options
        shippingOptions = [
          {
            shipping_rate: standardShippingRate,
          },
          {
            shipping_rate: ruralShippingRate,
          },
        ];
      }
    }
    else {
      if (totalAmount >= 15000) {
        shippingOptions = [
          {
            shipping_rate: freeShippingRateAU,
          },
        ];
      }
      else {
        shippingOptions = [
          {
            shipping_rate: standardShippingRateAU,
          },
        ];
      }
      payment_method_types = ['card'];
    }

    console.log(`Shipping options: ${JSON.stringify(shippingOptions)}`);

    // Create success URL with landingURL as a query parameter
    const successUrl = `https://www.primalpantry.co.nz/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}`;

    // Create a Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: payment_method_types,
      shipping_address_collection: {
        allowed_countries: ['NZ'], // Restrict to New Zealand
      },
      shipping_options: shippingOptions,
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl, // Updated success URL
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