

document.querySelectorAll('.play-button').forEach(button => {
    button.addEventListener('click', function() {
      const videoId = this.getAttribute('data-video-id');
      // Replace 'video_player_div_id' with the ID of the div where you want to embed the YouTube player
      document.getElementById('video_player_div_id').innerHTML = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
    });
  });



  document.addEventListener('scroll', function() {
  var elements = document.querySelectorAll('.element');
  elements.forEach(function(element) {
    if (isElementInViewport(element)) {
      element.classList.add('show');
    }
  });
});

function isElementInViewport(el) {
  var rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}




    // JavaScript to handle image switching
    const thumbnails = document.querySelectorAll('.product-image');
    const mainImage = document.querySelector('.main-image');

    thumbnails.forEach(thumbnail => {
        thumbnail.addEventListener('click', () => {
            mainImage.src = thumbnail.src;
            mainImage.alt = thumbnail.alt;
        });
    });




    <!-- Form submit js -->

        function redirectUser() {
            setTimeout(function(){
                window.location = "/pages/book/";
            }, 1000);
        }


    <!-- faq js for accordion-->

        document.addEventListener("DOMContentLoaded", function() {
  var accordionItems = document.querySelectorAll(".accordion-item");

  accordionItems.forEach(function(item) {
    var heading = item.querySelector(".accordion-heading");
    var content = item.querySelector(".accordion-content");

    heading.addEventListener("click", function() {
      this.classList.toggle("active");
      content.classList.toggle("active");
    });
  });
});


    //     document.addEventListener("DOMContentLoaded", function() {
    //   var showMoreButton = document.querySelector(".show-more-button");
    //   var hiddenDivs = document.querySelectorAll(".hidden-div");
    
    //   // Hide the additional divs on page load
    //   hiddenDivs.forEach(function(div) {
    //     div.style.display = "none";
    //   });
    
    //   showMoreButton.addEventListener("click", function() {
    //     hiddenDivs.forEach(function(div) {
    //       div.style.display = div.style.display === "none" ? "block" : "none";
    //     });
    
    //     // Toggle the text of the button
    // if (showMoreButton.innerText === "Show Less") {
    //   showMoreButton.innerText = "Show All";
    // } else {
    //   showMoreButton.innerText = "Show Less";
    // }
    //   });
    // });

// Function to check if an element is in the viewport
function isInViewport(element) {
  var rect = element.getBoundingClientRect();
  return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

// Function to handle scroll event for each fade-in element
function handleScroll() {
  var elements = document.querySelectorAll('.fade-in-element');
  elements.forEach(function(element) {
      if (isInViewport(element) && !element.classList.contains('fade-in-visible')) {
          element.classList.add('fade-in-visible');
      }
  });
}

// Add scroll event listener
window.addEventListener('scroll', handleScroll);
// Check on initial page load
handleScroll();










// Check if the bubble was closed previously in the session
if (localStorage.getItem('bubbleClosed') === 'true') {
  document.getElementById('discountBubble').style.display = 'none';
}

function openModal() {
  document.getElementById('modal').style.display = 'block';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

function closeBubble() {
  document.getElementById('discountBubble').style.display = 'none';
  // Set a flag in local storage to remember that the bubble was closed for the session
  localStorage.setItem('bubbleClosed', 'true');
}
