const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');
const crypto = require('crypto');

const FACEBOOK_PIXEL_ID = '809100344281173';
const ACCESS_TOKEN = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD';
const webhookSecret = process.env.CHECKOUT_COMPLETED_SECRET;

exports.handler = async (event, context) => {
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const customerEmail = session.customer_details.email;
    
    // Pass the email to the trackPurchase function to handle Facebook tracking
    await trackPurchase(customerEmail);

    console.log(`Purchase completed for ${customerEmail}`);
  }

  return { statusCode: 200, body: 'Webhook received successfully' };
};

async function trackPurchase(email) {
  const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
  const requestBody = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        user_data: { em: hashedEmail },
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
      console.error('Error sending event to Facebook:', errorData);
    } else {
      console.log('Event successfully sent to Facebook.');
    }
  } catch (error) {
    console.error('Error in Facebook Conversions API:', error);
  }
}
