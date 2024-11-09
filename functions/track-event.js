const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');  // Import fetch for making HTTP requests
const crypto = require('crypto');    // Node.js built-in module for hashing
const FACEBOOK_PIXEL_ID = '809100344281173';  // Replace with your Pixel ID
const ACCESS_TOKEN = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD';  // Replace with your Access Token
const endpointSecret = require('endpointSecret')(process.env.CHECKOUT_COMPLETED_SECRET);

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}

exports.handler = async (event, context) => {
  const sig = event.headers['stripe-signature'];
  
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const customerEmail = session.customer_details.email;
    const hashedEmail = hashEmail(customerEmail);

    const requestBody = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          user_data: {
            em: hashedEmail,
          },
        },
      ],
    };

    try {
      const response = await fetch(`https://graph.facebook.com/v21.0/${FACEBOOK_PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error response from Facebook:', errorData);
        return { statusCode: 500, body: JSON.stringify({ error: errorData.error.message }) };
      }

      return { statusCode: 200, body: 'Event sent to Facebook successfully' };
    } catch (error) {
      console.error('Error sending event to Facebook:', error);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send event to Facebook' }) };
    }
  }

  return { statusCode: 200, body: 'Webhook received' };
};
