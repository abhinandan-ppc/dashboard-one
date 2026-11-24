const DAY = 86400000;
const INDIA_OFFSET = 19800000;

// A daily schedule is interpreted in India time, independent of the worker's
// environment or the browser that edited it.
export function nextScheduledTime(time, after = Date.now()) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw Error('Invalid schedule time');
  const [hours, minutes] = time.split(':').map(Number);
  const day = Math.floor((after + INDIA_OFFSET) / DAY);
  let target = day * DAY + hours * 3600000 + minutes * 60000 - INDIA_OFFSET;
  if (target <= after) target += DAY;
  return target;
}

export function indiaYear(timestamp) {
  return new Date(timestamp + INDIA_OFFSET).getUTCFullYear();
}
