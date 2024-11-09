const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');  // Import crypto for hashing email

const FACEBOOK_PIXEL_ID = '809100344281173';  // Replace with your Pixel ID
const ACCESS_TOKEN = 'EAAU9shr9R4gBO0liRd17Q4qSuPWsaq4O2AT8nbc4SLOwILbfdeGlIIDZArDIfmyCER94PiVToweFgqLca9AYzuVOl4IUfSWZBxcZAcuWnPxzyvnaszTXBvfkGxQBy1N1kQ4Ymb96L7SZCvfJCnRoZAuFIok52rur0B3HOJegQZAMz7ZCiRUyxEQ7ZBxmPS4911Y1cni8PzcZC78ZCkjNFZCOQZDZD';  // Replace with your Access Token
const webhookSecret = process.env.CHECKOUT_COMPLETED_SECRET;

exports.handler = async (event, context) => {
  // Dynamically import node-fetch
  const fetch = (await import('node-fetch')).default;

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
    console.log('Stripe event verified:', stripeEvent.type);  // Log successful verification
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
      productId: session.metadata ? session.metadata.product_id : 'N/A',  // Use a default if metadata is missing
    };

    console.log(`Attempting to track purchase for ${customerEmail} with data:`, purchaseData);

    // Call your function to track the purchase
    await trackPurchase(purchaseData.email);

    console.log(`Purchase event successfully processed for ${customerEmail}`);
  }

  return { statusCode: 200, body: 'Webhook received successfully' };
};

// Function to track purchase via Facebook Conversions API
async function trackPurchase(email) {
  const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');  // Hash email for privacy
  const TEST_EVENT_CODE = 'TEST68588';  // Replace with your test event code from Facebook

  const requestBody = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        user_data: { em: hashedEmail },
      },
    ],
    test_event_code: TEST_EVENT_CODE  // Add the test event code at the root level
  };

  console.log('Sending event to Facebook:', requestBody);

  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${FACEBOOK_PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();
    if (!response.ok) {
      console.error('Error sending event to Facebook:', responseData);
    } else {
      console.log('Event successfully sent to Facebook:', responseData);
    }
  } catch (error) {
    console.error('Error in Facebook Conversions API:', error);
  }
}