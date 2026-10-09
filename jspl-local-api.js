// On loopback hosts other than the local sheet server, route only the three
// private-sheet API requests to local-auth.mjs. This lets VS Code Live Preview
// keep serving the site on its current port while credentials stay server-side.
(function(){
  var host = window.location.hostname;
  var localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if(!localHost || !window.location.port || window.location.port === '4173') return;

  var nativeFetch = window.fetch.bind(window);
  var sheetRoutes = /^\/api\/(?:ebtp|zstk|autobtr)-proxy(?:\?|$)/;
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url);
    if(typeof url === 'string' && sheetRoutes.test(url)){
      var destination = 'http://127.0.0.1:4173' + url;
      if(typeof input === 'string' || input instanceof URL) input = destination;
      else input = new Request(destination, input);
      init = Object.assign({}, init || {}, { mode: 'cors', credentials: 'omit' });
    }
    return nativeFetch(input, init);
  };
})();
