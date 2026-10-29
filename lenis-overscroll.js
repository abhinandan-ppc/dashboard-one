// lenis-overscroll.js - Lenis smooth scroll support
// This file ensures Lenis smooth scroll works on mobile devices
// by using passive touch events that don't block Lenis scroll
// The edge scroll stretch effect has been removed to prevent breaking dashboards

(function(){'use strict';
// Ensure Lenis smooth scroll works on all devices
// by using passive touch events that don't block Lenis scroll
window.addEventListener('load', function() {
  // Lenis smooth scroll is handled by the main script
  // This file ensures touch events don't block Lenis smooth scroll
  document.body.classList.add('lenis-enabled');
});
// Passive touch event handler (mobile compatibility)
// Allows Lenis to handle touch scroll natively
// passive: true allows the browser to scroll naturally
document.addEventListener('touchmove', function(e) {
  // Allow Lenis to handle touch scroll natively
  // passive: true allows the browser to scroll naturally
}, { passive: true });
// Prevent the stretch effect from interfering with dashboard functionality
document.body.style.overscrollBehavior = 'contain';
