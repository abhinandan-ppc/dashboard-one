// Sweeps the darkness slider and reports the body-text contrast at each stop.
//
// The contrast problem this checks is structural, not empirical: a naive
// cross-fade ramps --bg and --text together, so at the midpoint both land on
// the same luminance and the text disappears. Rendering showed exactly that —
// VDO Generator at darkness 50 came out light grey text on a mid grey page.
//
// It is checked here in Node rather than in a browser because the token maths
// is fully determined by theme.css: surfaces interpolate between two literals
// at the steepened position, and the text roles are a hard step at
// DARK_THRESHOLD. The browser is still the authority on whether the CSS
// resolves the way this model says it does — scripts/shoot-page.mjs reports
// the measured ratio for that.
const LIGHT_BG = [0xf0, 0xf4, 0xf8];
// Must be kept in step with theme.css's --bg dark end, which is AMOLED black.
// These two are duplicated rather than parsed out of the stylesheet because
// colour-mix() cannot be evaluated here without a CSS engine; if you change one,
// change the other or this script will silently certify a ramp the browser no
// longer renders. scripts/shoot-page.mjs is the check that reads the real value
// back out of a browser.
const DARK_BG = [0x00, 0x00, 0x00];
// Pure black / pure white rather than the off-black and off-white the two
// static themes used. This is not cosmetic: those sit at luminance 0.006 and
// 0.95, which leaves NO window where both ends clear 4.5:1 against a mid-grey
// surface (black needs surface lum >= 0.202, white needs <= 0.183). At the
// extremes the passable windows overlap instead, so the ramp becomes
// reachable.
const LIGHT_TEXT = [0x00, 0x00, 0x00];
const DARK_TEXT = [0xff, 0xff, 0xff];
const srgb = c => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => {
  const [x, y] = [srgb(a), srgb(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Mirrors theme.css --tds: clamp(0%, theme-d * SLOPE% + OFFSET%, 100%).
const ramp = (d, slope, offset) => Math.max(0, Math.min(100, d * slope + offset)) / 100;

// Worst contrast anywhere on the ramp, for a given slope/offset/threshold.
function worstOver(slope, offset, threshold) {
  let worst = { ratio: Infinity, d: 0 };
  // Step finely: the dip is only a few slider units wide.
  for (let d = 0; d <= 100; d += 0.25) {
    const bg = mix(LIGHT_BG, DARK_BG, ramp(d, slope, offset));
    const text = d < threshold ? LIGHT_TEXT : DARK_TEXT;
    const ratio = contrast(bg, text);
    if (ratio < worst.ratio) worst = { ratio, d };
  }
  return worst;
}

// A continuous light-to-dark background CANNOT hold 4.5:1 with white text on a
// mid-luminance surface: 4.5:1 against white needs surface luminance <= 0.183,
// while 4.5:1 against black needs >= 0.202. So there is a real gap, and the
// job is to find the slope and threshold that make it as narrow and as shallow
// as possible rather than to pretend it away.
let best = null;
for (let slope = 1.0; slope <= 4.0; slope += 0.1) {
  for (let offset = -30; offset <= 30; offset += 1) {
    for (let threshold = 20; threshold <= 60; threshold += 1) {
      const w = worstOver(slope, offset, threshold);
      if (!best || w.ratio > best.worst.ratio) {
        best = { slope: +slope.toFixed(1), offset, threshold, worst: w };
      }
    }
  }
}

// Printed in the exact CSS form so the test can compare this string against
// what theme.css actually declares, rather than re-deriving it from loose
// number parsing on both sides.
const sign = best.offset < 0 ? '-' : '+';
const rampCss = `clamp(0%, calc(var(--theme-d) * ${best.slope}% ${sign} ${Math.abs(best.offset)}%), 100%)`;
console.log(`best ramp: --tds: ${rampCss}`);
console.log(`           DARK_THRESHOLD = ${best.threshold}`);
console.log(`           worst body contrast ${best.worst.ratio.toFixed(2)}:1 at d=${best.worst.d}\n`);

for (let d = 0; d <= 100; d += 5) {
  const bg = mix(LIGHT_BG, DARK_BG, ramp(d, best.slope, best.offset));
  const text = d < best.threshold ? LIGHT_TEXT : DARK_TEXT;
  console.log(`  d=${String(d).padStart(3)}  ${(d < best.threshold ? 'light' : 'dark').padEnd(5)}  `
    + `${contrast(bg, text).toFixed(2)}:1`);
}

if (best.worst.ratio < 4.5) {
  console.error(`\nFAIL: best achievable is ${best.worst.ratio.toFixed(2)}:1, below the 4.5:1 WCAG AA floor.`);
  console.error('A continuous light-to-dark background cannot clear 4.5:1 at every');
  console.error('position — the usable options are to accept the dip, or to snap the');
  console.error('background between the two ends instead of ramping it.');
  process.exit(1);
}
console.log('\nOK: body text stays at or above 4.5:1 across the whole ramp');
