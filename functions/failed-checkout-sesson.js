const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  const fetch = (await import('node-fetch')).default; // Dynamically import node-fetch
  const sig = event.headers['stripe-signature'];

  let eventObj;

  try {
    eventObj = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed.', err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  if (eventObj.type === 'checkout.session.expired') {
    const session = eventObj.data.object;

    const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSdQZZHQuMdfYNjgfq7SSA6acDvvIFHnRRfjS3KVR-bOJd37uw/formResponse';
    const formData = {
      'entry.27537500': session.id, // sessionId
      'entry.1220453666': session.customer_email, // customerEmail
      'entry.651163627': session.amount_total, // amountTotal
      'entry.1222770193': session.currency, // currency
      'entry.1839560023': JSON.stringify(session.display_items), // lineItems
      'entry.529148244': new Date(session.created * 1000).toISOString(), // created
    };

    const formParams = new URLSearchParams(formData);

    // Submit the form
    try {
      const response = await fetch(formUrl, {
        method: 'POST',
        body: formParams,
      });

      if (!response.ok) {
        throw new Error(`Form submission failed: ${response.statusText}`);
      }

      console.log('Form submitted successfully');
    } catch (error) {
      console.error('Error submitting form:', error);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true }),
  };
};
