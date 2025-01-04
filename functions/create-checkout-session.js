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
    const standardShippingRate = 'shr_1QKTanFZRwx5tlYmmr0UUDQw';
    const mediumShippingRate = 'shr_1QKTanFZRwx5tlYmmr0UUDQw';
    const freeShippingRate = 'shr_1QKTagFZRwx5tlYmswF6jANR';
    const ruralShippingRate = 'shr_1QKTajFZRwx5tlYmayPCyClE'; // Replace with your actual rural shipping rate ID

    let shippingOptions = [];

    if (totalAmount >= 8000) {
      shippingOptions = [
        {
          shipping_rate: freeShippingRate,
        },
      ];
    } else if (totalAmount >= 1000) {
      shippingOptions = [
        {
          shipping_rate: mediumShippingRate,
        },
        {
          shipping_rate: ruralShippingRate,
        }, // Include rural shipping as an option
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

    console.log(`Shipping options: ${JSON.stringify(shippingOptions)}`);

    // Create success URL with landingURL as a query parameter
    const successUrl = `https://www.primalpantry.co.nz/pages/thank-you?landing_url=${encodeURIComponent(decodedLandingURL)}`;

    // Create a Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['NZ'], // Restrict to New Zealand
      },
      shipping_options: shippingOptions,
      line_items: lineItems,
      mode: 'payment',
      allow_promotion_codes: true, // Enable promotion codes at checkout
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
