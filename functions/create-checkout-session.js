const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    const { cart } = JSON.parse(event.body);

    // Check if the cart is valid
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      throw new Error('Cart is empty or not provided.');
    }

    const lineItems = [];
    let totalAmount = 0;

    // Process each cart item to create line items
    for (const item of cart) {
      try {
        // Convert quantity to an integer
        const quantity = parseInt(item.quantity, 10);

        // Validate each item in the cart
        if (!item.priceId || isNaN(quantity) || quantity <= 0) {
          throw new Error(`Invalid cart item: Missing or incorrect priceId or quantity for item: ${JSON.stringify(item)}`);
        }

        console.log(`Retrieving price for priceId: ${item.priceId}`);

        // Retrieve the price from Stripe
        const price = await stripe.prices.retrieve(item.priceId);

        // Validate retrieved price
        if (!price || !price.unit_amount) {
          throw new Error(`Invalid price retrieved for priceId: ${item.priceId}`);
        }

        console.log(`Price retrieved: ${price.unit_amount} cents, Quantity: ${quantity}`);

        // Create line item for Stripe Checkout
        lineItems.push({
          price: item.priceId,
          quantity: quantity, // Use the integer quantity
        });

        // Accumulate the total amount
        totalAmount += quantity * price.unit_amount;
      } catch (priceError) {
        console.error(`Error processing cart item with priceId: ${item.priceId}`, priceError);
        throw new Error(`Failed to process item in cart: ${priceError.message}`);
      }
    }

    // Log the total amount for debugging
    console.log(`Total amount in cents: ${totalAmount}`);

    // Determine the shipping rate based on the total amount
    const standardShippingRate = 'shr_1PasnCABkrUo6tgOd7bkp2rT';
    const mediumShippingRate = 'shr_1PcZ8aABkrUo6tgODQmr9JHk';
    const freeShippingRate = 'shr_1PWrY7ABkrUo6tgODvMWsZjD';

    let shippingRate;
    if (totalAmount >= 8000) {
      shippingRate = freeShippingRate;
    } else if (totalAmount >= 1000) {
      shippingRate = mediumShippingRate;
    } else {
      shippingRate = standardShippingRate;
    }

    console.log(`Selected shipping rate ID: ${shippingRate}`);

    // Create a Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['NZ'], // Restrict to New Zealand
      },
      shipping_options: [
        {
          shipping_rate: shippingRate,
        },
      ],
      line_items: lineItems,
      mode: 'payment',
      allow_promotion_codes: true, // Enable promotion codes at checkout
      success_url: 'https://www.primebroth.co.nz/pages/thank-you',
      cancel_url: 'https://www.primebroth.co.nz/shop',
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
