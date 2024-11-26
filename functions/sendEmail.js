const nodemailer = require("nodemailer");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    // Parse the form data from the request body
    const { name, email, subject, message } = JSON.parse(event.body);

    // Validate that all fields are present
    if (!name || !email || !subject || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "All fields are required." }),
      };
    }

    // Set up the email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail", // Replace with your email provider
      auth: {
        user: process.env.EMAIL_USER, // Your email address from environment variable
        pass: process.env.EMAIL_PASS, // Your email password or app-specific password
      },
    });

    // Email details
    const mailOptions = {
      from: `"${name}" <${email}>`,
      to: "hello@primalpantry.co.nz", // Your email address
      subject: `Website Enquiry: ${subject}`, // Subject line
      text: message, // Plain text body
      replyTo: email, // Set the reply-to address
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    // Respond with a success message
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Email sent successfully!" }),
    };
  } catch (error) {
    console.error("Error sending email:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send email. Please try again later." }),
    };
  }
};
