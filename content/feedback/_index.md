---
title: "Feedback"
draft: false
---

<div>
    <h1>Thank you for your feedback!</h1>
    <p>Your feedback is being submitted...</p>
</div>

<script>
    // Function to get URL parameters
    function getQueryParams() {
        const params = {};
        window.location.search.substring(1).split("&").forEach(function (part) {
            const pair = part.split("=");
            params[pair[0]] = decodeURIComponent(pair[1]);
        });
        return params;
    }

    // Function to send the email
    function sendEmail(params) {
        const email = params.email;
        const rating = params.rating;
        const subject = "Customer Feedback";
        const body = `Rating: ${rating}\nEmail: ${email}`;
        const mailtoLink = `mailto:feedback@primebroth.co.nz?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        window.location.href = mailtoLink;
    }

    // Get URL parameters and send email on page load
    document.addEventListener("DOMContentLoaded", function() {
        const params = getQueryParams();
        if (params.email && params.rating) {
            sendEmail(params);
        } else {
            console.error("Missing email or rating parameter.");
        }
    });
</script>
