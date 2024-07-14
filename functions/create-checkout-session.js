const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  const { priceId, quantity } = JSON.parse(event.body);

  try {
    // Retrieve the price information from Stripe to calculate the total amount
    const price = await stripe.prices.retrieve(priceId);
    const amount = price.unit_amount * quantity;

    // Define the shipping rate IDs
    const standardShippingRate = 'shr_1PcZ8aABkrUo6tgODQmr9JHk'; // Replace with your actual standard shipping rate ID
    const freeShippingRate = 'shr_1PWrY7ABkrUo6tgODvMWsZjD'; // Free shipping rate ID

    // Determine the shipping rate based on the total amount
    let shippingRate;
    if (amount >= 8000 || (amount >= 300 && amount <= 1000)) {
      shippingRate = freeShippingRate;
    } else {
      shippingRate = standardShippingRate;
    }

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
      line_items: [
        {
          price: priceId,
          quantity: quantity,
        },
      ],
      mode: 'payment',
      allow_promotion_codes: true, // Enable entering promotion codes at checkout
      success_url: 'https://www.primebroth.co.nz/pages/thank-you',
      cancel_url: 'https://www.primebroth.co.nz/shop',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
