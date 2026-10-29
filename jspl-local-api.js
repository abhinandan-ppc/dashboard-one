// On loopback hosts other than the local data server, route private-sheet and
// truck Drive database requests to local-auth.mjs. This lets Live Preview keep
// serving the page on its own port while credentials stay server-side.
(function(){
  var host = window.location.hostname;
  // Also treat file:// (empty hostname) as local so API requests can reach the
  // local-auth server even if this HTML was opened directly from disk.
  var localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  var localDataApi = 'http://127.0.0.1:3000';
  if(!localHost) return;

  var nativeFetch = window.fetch.bind(window);
  var sheetRoutes = /^(?:https?:\/[^/]+)?\/api\/(?:ebtp|zstk|autobtr|truckdb|balance-heat)-proxy(?:\/|\?|$)|^(?:https?:\/[^/]+)?\/api\/database(?:\/|\?|$)/;
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url);
    if(typeof url === 'string' && sheetRoutes.test(url)){
      var destination = localDataApi + url;
      if (window.location.port === '3000' && url.indexOf('/api/database') === 0) destination = url;
      if(typeof input === 'string' || input instanceof URL) input = destination;
      else input = new Request(destination, input);
      init = Object.assign({}, init || {}, { mode: 'cors', credentials: 'omit' });
    }
    return nativeFetch(input, init);
  };
})();
