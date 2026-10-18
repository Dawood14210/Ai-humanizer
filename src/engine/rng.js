// rng.js — small seedable pseudo-random number generator (Mulberry32) so humanization
// can be deterministic when a seed is supplied, which helps testing and reproducibility.
export function makeRng(seed = Date.now()) {
  let t = seed >>> 0
  return function rng() {
    t = (t + 0x6d2b79f5) >>> 0
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
