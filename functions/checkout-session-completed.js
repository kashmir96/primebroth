const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');  // Import fetch for making HTTP requests
const crypto = require('crypto');     // Import crypto for hashing email

const FACEBOOK_PIXEL_ID = '809100344281173';  // Replace with your Pixel ID
const ACCESS_TOKEN = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD';  // Replace with your Access Token
const webhookSecret = process.env.CHECKOUT_COMPLETED_SECRET;

exports.handler = async (event, context) => {
  if (!webhookSecret) {
    console.error('⚠️  Webhook secret is not defined.');
    return {
      statusCode: 500,
      body: 'Webhook secret is not defined in environment variables.',
    };
  }

  // Verify the event came from Stripe
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Handle the event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    // Extract the email and other relevant information
    const customerEmail = session.customer_details.email;
    const purchaseData = {
      email: customerEmail,
      amount_total: session.amount_total,
      currency: session.currency,
      productId: session.metadata ? session.metadata.product_id : null,  // Check for metadata
    };

    // Call your function to track the purchase
    await trackPurchase(purchaseData.email);

    // Optionally, log or process further if needed
    console.log(`Purchase completed for ${customerEmail}`, purchaseData);
  }

  return { statusCode: 200, body: 'Webhook received successfully' };
};

// Example function to track purchase via Facebook Conversions API
async function trackPurchase(email) {
  const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');  // Hash email for privacy
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
