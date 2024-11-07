// netlify/functions/facebook-conversion.js
const fetch = require('node-fetch');  // Import fetch for making HTTP requests
const crypto = require('crypto');    // Node.js built-in module for hashing

// Facebook Pixel ID and Access Token (replace with your actual values)
const FACEBOOK_PIXEL_ID = '809100344281173';  // Replace with your Pixel ID
const ACCESS_TOKEN = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD';  // Replace with your Access Token

// Helper function to hash the email
function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');  // Normalize to lower case and hash
}
exports.handler = async (event, context) => {
  try {
    // Parse the incoming data from the frontend
    const data = JSON.parse(event.body);
    // Hash the email and prepare the payload for Facebook Conversions API
    const hashedEmail = hashEmail(data.email);
    const requestBody = {
      data: [
        {
          event_name: 'Purchase',  // Replace with the event you want to track, e.g., 'Lead', 'Purchase'
          event_time: Math.floor(Date.now() / 1000),  // Current time in seconds
          user_data: {
            em: hashedEmail,  // Hashed email
          },
        },
      ],
    };
    // Send the event to Facebook Conversions API
    const response = await fetch(`https://graph.facebook.com/v21.0/${FACEBOOK_PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    // Check if the request was successful
    if (!response.ok) {
      const errorData = await response.json();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: errorData.error.message }),
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Event successfully sent to Facebook.' }),
    };
  } catch (error) {
    console.error('Error in Facebook Conversions API:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
}; (edited) 
8:53
// Assuming the email is collected when the user submits a form or makes a purchase
function trackPurchase(email) {
  fetch('/.netlify/functions/facebook-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: email
    })
  })
  .then(response => response.json())
  .then(data => console.log('Success:', data))
  .catch(error => console.error('Error:', error));
}
// Example of how to trigger the function
const userEmail = 'customer@example.com';  // Replace with actual user email
trackPurchase(userEmail);