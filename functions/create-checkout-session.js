const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  const { cart } = JSON.parse(event.body);

  try {
    if (!cart || cart.length === 0) {
      throw new Error('Cart is empty or not provided.');
    }

    const lineItems = [];
    let totalAmount = 0;

    // Retrieve prices and create line items
    for (const item of cart) {
      try {
        if (!item.priceId || !item.quantity) {
          throw new Error(`Invalid cart item: Missing priceId or quantity for item: ${JSON.stringify(item)}`);
        }

        console.log(`Retrieving price for priceId: ${item.priceId}`);
        const price = await stripe.prices.retrieve(item.priceId);
        
        if (!price || !price.unit_amount) {
          throw new Error(`Invalid price retrieved for priceId: ${item.priceId}`);
        }

        console.log(`Price retrieved: ${price.unit_amount}, Quantity: ${item.quantity}`);

        lineItems.push({
          price: item.priceId,
          quantity: item.quantity,
        });

        // Calculate total amount in cents
        totalAmount += item.quantity * price.unit_amount;
      } catch (priceError) {
        console.error(`Error processing cart item with priceId: ${item.priceId}`, priceError);
        throw priceError; // Re-throw to be caught in the outer catch block
      }
    }

    // Log the total amount to help debug
    console.log(`Total amount in cents: ${totalAmount}`);

    // Define the shipping rate IDs
    const standardShippingRate = 'shr_1PasnCABkrUo6tgOd7bkp2rT'; // Shipping rate ID for orders below $10
    const mediumShippingRate = 'shr_1PcZ8aABkrUo6tgODQmr9JHk'; // Shipping rate ID for orders between $10 and $80
    const freeShippingRate = 'shr_1PWrY7ABkrUo6tgODvMWsZjD'; // Free shipping rate ID for orders above $80

    // Determine the shipping rate based on the total amount
    let shippingRate;
    if (totalAmount >= 8000) {
      shippingRate = freeShippingRate;
    } else if (totalAmount >= 1000) {
      shippingRate = mediumShippingRate;
    } else {
      shippingRate = standardShippingRate;
    }

    // Create a checkout session with the line items
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
      allow_promotion_codes: true, // Enable entering promotion codes at checkout
      success_url: 'https://www.primebroth.co.nz/pages/thank-you',
      cancel_url: 'https://www.primebroth.co.nz/shop',
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
      body: JSON.stringify({ error: `Error creating checkout session: ${error.message}` }),
    };
  }
};
