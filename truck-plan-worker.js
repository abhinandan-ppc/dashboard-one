// Runs the truck-plan allocation off the main thread so the page stays responsive.
// Loads the same engine file the page uses; the page falls back to running it inline
// if this worker can't start (e.g. the page is opened from file://).
self.window = self;
importScripts('truck-dashboard-libs.js');

self.onmessage = async (e) => {
  try {
    const res = await self.TruckEngine.allocate(e.data.rows, self.INDIA_CITY_TABLE,
      (frac, n) => self.postMessage({ type: 'progress', frac, n }));
    self.postMessage({ type: 'done', res });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
