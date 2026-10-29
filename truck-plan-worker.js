// Runs the truck-plan allocation off the main thread so the page stays responsive.
// The page keeps one worker alive for the whole session, so the engine is loaded
// once here rather than on every plan build.
// Loads the same engine file the page uses; the page falls back to running it inline
// if this worker can't start (e.g. the page is opened from file://).
self.window = self;
importScripts('truck-dashboard-libs.js');

self.onmessage = async (e) => {
  // The page pings the worker once on start so the engine file is already parsed and
  // cached when the first real build arrives.
  if (e.data && e.data.warmup) { self.postMessage({ type: 'warm' }); return; }
  const seq = e.data && e.data.seq;
  try {
    const res = await self.TruckEngine.allocate(e.data.rows, self.INDIA_CITY_TABLE,
      (frac, n) => self.postMessage({ type: 'progress', seq, frac, n }));
    self.postMessage({ type: 'done', seq, res });
  } catch (err) {
    // retryable: the page re-runs this job inline instead of failing the build.
    self.postMessage({ type: 'error', seq, retryable: true, message: String(err && err.message || err) });
  }
};
