// Local static previews have no /api routes. Use the service-account server.
function dashboardApiUrl(path) {
  const host = window.location.hostname;
  if ((host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
       window.location.protocol === 'vscode-webview:') &&
      window.location.port !== '3100') {
    return 'http://127.0.0.1:3100' + path;
  }
  return path;
}
