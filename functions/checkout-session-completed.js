const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const endpointSecret = require('endpointSecret')(process.env.CHECKOUT_COMPLETED_SECRET);

exports.handler = async (event, context) => {
  // Verify the event came from Stripe
  const sig = event.headers['stripe-signature'];
  
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
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
      productId: session.metadata.product_id,  // Assuming you store product info in metadata
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
  // Your Facebook tracking function here
  console.log(`Tracking purchase for email: ${email}`);
}
