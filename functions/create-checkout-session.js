const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use environment variable

exports.handler = async (event, context) => {
  const { productId, quantity } = JSON.parse(event.body);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: productId, // Use the actual price ID for the product
          quantity: quantity,
        },
      ],
      mode: 'payment',
      success_url: 'https://www.primebroth.co.nz/pages/thank-you',
      cancel_url: 'https://www.primebroth.co.nz/shop',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
