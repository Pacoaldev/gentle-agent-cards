// The Gentle Shell rose: the brand rose image acting out each agent status.
// All motion is native (`loop`): no timer redraws the mod. The rose asset is
// `docs/assets/brand/rose.png` of Gentle-AI (200x261, transparent).

import { div, image } from "gpui-kit";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("gpui-kit").Element} Element */
/** @typedef {import("gpui-shell").LoopPolicy} LoopPolicy */
/** @typedef {Record<string, Color | undefined>} ThemeColors */

export const STAGE = 64;

/** @type {Color} */
const ROSE = "#f0447a";

// The rose on the stage: 200x261 source. Halo anchor = the center of the bloom
// head mapped into the drawn box (not the 64px square center, not the alpha
// centroid: that sits on the stem and pinned the disc half above the stage).
const ROSE_SRC_W = 200, ROSE_SRC_H = 261;
const ROSE_W = 40, ROSE_H = 52;
const roseLeft = (STAGE - ROSE_W) / 2, roseTop = 6;
const HALO_CX = roseLeft + (99.5 / ROSE_SRC_W) * ROSE_W;
const HALO_CY = roseTop + (68 / ROSE_SRC_H) * ROSE_H + 3; // +3: the mist reads best just under the bloom
// The halo needs air: a 64px stage with a full-bleed rose shows no rim, so the
// rose is drawn at 40x52 and the halo may reach d=50 around the bloom head.

/**
 * Append a hex alpha suffix while preserving the `Color` template literal type.
 * @param {Color | undefined} color
 * @param {string} alpha
 * @returns {Color}
 */
const withAlpha = (color, alpha) => /** @type {Color} */ (`${color ?? ROSE}${alpha}`);

/**
 * An element at a fixed spot in the stage.
 * @param {Element} el
 * @param {number} x
 * @param {number} y
 */
const at = (el, x, y) => el.absolute().left(x).top(y);

/**
 * Soft halo on the bloom: pinned with static `left`/`top` at the midpoint of
 * [a, b] so the center stays true around (HALO_CX, HALO_CY) without needing a
 * `left`/`top` loop (which stays at 0,0 until the first tick). Two discs out of
 * phase (outer grows while inner shrinks) read as one continuous breathing mist.
 * @param {Color} tint
 * @param {number} d1
 * @param {number} d2
 * @param {number} period
 * @param {number} [opacity]
 */
function halo(tint, d1, d2, period, opacity = 0.14) {
  /**
   * @param {number} a
   * @param {number} b
   * @param {number} opFrom
   * @param {number} opTo
   * @param {number} p
   */
  const disc = (a, b, opFrom, opTo, p) => {
    const mid = (a + b) / 2;
    const r = Math.max(a, b) / 2;
    return at(
      div()
        .w(mid)
        .h(mid)
        .rounded(r)
        .bg(tint)
        .loop("width", { from: a, to: b, period: p })
        .loop("height", { from: a, to: b, period: p })
        .loop("opacity", { from: opFrom, to: opTo, period: p }),
      HALO_CX - mid / 2,
      HALO_CY - mid / 2,
    );
  };
  const w1 = d1 * 1.2, w2 = d2 * 1.2;
  const c1 = d1 * 0.78, c2 = d2 * 0.78;
  return div()
    .absolute()
    .left(0).top(0).w(STAGE).h(STAGE)
    .children([
      disc(w1, w2, opacity * 0.5, opacity, period),
      disc(c2, c1, opacity * 1.35, opacity * 0.65, Math.round(period * 0.85)),
    ]);
}

/**
 * The rose image, lifted by the status motion (`motion`: a `top` loop).
 * Drawn 3px below the top of the stage, matching the halo's +3 anchor offset.
 * @param {LoopPolicy | null} motion
 */
function rose(motion) {
  const r = at(image("mods/gentle-agent-cards/rose.png").w(ROSE_W).h(ROSE_H), roseLeft, roseTop + 3);
  const g = div().absolute().left(0).w(STAGE).h(STAGE).children([r]);
  return motion ? g.loop("top", motion) : g.top(0);
}

/**
 * Keeps a breathing halo on the bloom while the rose bobs in the same wrapper.
 * @param {Element} el
 * @param {LoopPolicy | null} motion
 */
const withBob = (el, motion) =>
  motion
    ? div().absolute().left(0).w(STAGE).h(STAGE).children([el]).loop("top", motion)
    : el;

/**
 * A rising pollen/spark particle that drifts vertically and pulses in opacity.
 * @param {Color} color
 * @param {number} x
 * @param {number} size
 * @param {number} fromY
 * @param {number} toY
 * @param {number} period
 * @param {number} [maxOp]
 */
const spark = (color, x, size, fromY, toY, period, maxOp = 0.85) =>
  div()
    .absolute()
    .left(x)
    .w(size)
    .h(size)
    .rounded(size / 2)
    .bg(color)
    .loop("top", { from: fromY, to: toY, period })
    .loop("opacity", { from: 0.1, to: maxOp, period: Math.round(period / 2) });

/**
 * A "z" that rises, sways slightly, and fades.
 * @param {ThemeColors} t
 * @param {number} x
 * @param {number} size
 * @param {number} period
 * @param {number} from
 * @param {number} to
 */
const zzz = (t, x, size, period, from, to) =>
  div()
    .absolute()
    .left(x)
    .text_size(size)
    .font_bold()
    .text_color(t.muted ?? ROSE)
    .loop("top", { from, to, period, easing: "linear" })
    .loop("left", { from: x - 1, to: x + 1.5, period: Math.round(period * 0.6) })
    .child(div().loop("opacity", { from: 0, to: 0.9, period: Math.round(period / 2) }).child("z"));

/**
 * The ground line every scene stands on, optionally breathing in opacity with the scene.
 * @param {ThemeColors} _t
 * @param {Color} color
 * @param {number} [period]
 * @param {number} [minOp]
 * @param {number} [maxOp]
 */
const ground = (_t, color, period = 0, minOp = 0.4, maxOp = 0.75) => {
  const bar = at(div().w(48).h(2.5).rounded(1).bg(withAlpha(color, "88")), 8, 58);
  return period ? bar.loop("opacity", { from: minOp, to: maxOp, period }) : bar;
};

/**
 * Working: the rose bobs gently, its halo breathes, and glowing pollen sparks rise around it.
 * @param {ThemeColors} t
 */
function working(t) {
  const c = t.working ?? ROSE;
  /** @type {LoopPolicy} */
  const bob = { from: -1, to: 1.5, period: 900 };
  return [
    withBob(halo(c, 34, 44, 1800, 0.15), bob),
    ground(t, c, 900, 0.45, 0.8),
    spark(c, 11, 3, 42, 16, 1700, 0.75),
    spark(ROSE, 50, 2.5, 38, 12, 1350, 0.8),
    spark(c, 16, 2, 26, 8, 2100, 0.65),
    rose(bob),
  ];
}

/**
 * Sleeping: a slow deep breath, a dim halo, and three drifting "z".
 * @param {ThemeColors} t
 */
function idle(t) {
  const c = t.idle ?? t.dim ?? ROSE;
  /** @type {LoopPolicy} */
  const bob = { from: 0, to: 2.2, period: 3200 };
  return [
    withBob(halo(c, 34, 46, 3400, 0.1), bob),
    ground(t, c, 3200, 0.3, 0.55),
    rose(bob),
    zzz(t, 47, 9, 2600, 16, 4),
    zzz(t, 52, 11, 3100, 10, -4),
    zzz(t, 43, 8, 3700, 4, -8),
  ];
}

/**
 * Needs you: fast dual-disc alert pulse, centered horizontal shake, and side alert sparks.
 * @param {ThemeColors} t
 */
function blocked(t) {
  const c = t.blocked ?? ROSE;
  /** @type {LoopPolicy} */
  const shake = { from: -1.5, to: 1.5, period: 240, easing: "linear" };
  return [
    halo(c, 40, 52, 520, 0.28),
    ground(t, c, 520, 0.5, 0.95),
    spark(c, 9, 3.5, 28, 18, 520, 0.9),
    spark(c, 51, 3.5, 26, 16, 620, 0.9),
    rose(null).loop("left", shake),
  ];
}

/**
 * Done: the rose jumps in celebration while bright sparks float up around the wide bloom.
 * @param {ThemeColors} t
 */
function done(t) {
  const c = t.done ?? ROSE;
  /** @type {LoopPolicy} */
  const bob = { from: 0, to: -4.5, period: 750 };
  return [
    withBob(halo(c, 38, 50, 1400, 0.17), bob),
    ground(t, c, 750, 0.35, 0.8),
    spark(c, 10, 3, 36, 10, 1200, 0.85),
    spark(c, 51, 3, 34, 8, 1450, 0.85),
    spark(ROSE, 17, 2.5, 20, 5, 1100, 0.75),
    spark(c, 45, 2.5, 22, 6, 1300, 0.75),
    rose(bob),
  ];
}

/**
 * Waiting: the rose sways gently while a dew drop falls onto the bloom and a soft ripple breathes below.
 * @param {ThemeColors} t
 */
function waiting(t) {
  const c = t.waiting ?? t.dim ?? ROSE;
  /** @type {LoopPolicy} */
  const bob = { from: -0.5, to: 1, period: 2400 };
  const dropX = Math.round(HALO_CX) - 2;
  return [
    withBob(halo(c, 34, 46, 2400, 0.12), bob),
    ground(t, c, 2400, 0.35, 0.65),
    rose(bob).loop("left", { from: -0.8, to: 0.8, period: 2400 }),
    at(
      div()
        .w(4)
        .h(6)
        .rounded(2)
        .bg(c)
        .loop("top", { from: 2, to: roseTop + 8, period: 1400, easing: "ease-in" })
        .loop("opacity", { from: 0.15, to: 0.95, period: 700 }),
      dropX,
      0,
    ),
  ];
}

/** @type {Record<string, (t: ThemeColors) => Element[]>} */
const SCENES = { working, idle, blocked, done, waiting };

/**
 * The 64px stage of one card: the tint of the status behind, the rose in front.
 * @param {ThemeColors} t
 * @param {string} status
 */
export function flowerStage(t, status) {
  const tint = t[status] ?? ROSE;
  const scene = SCENES[status] ?? idle;
  return div()
    .relative()
    .flex_none()
    .w(STAGE)
    .h(STAGE)
    .rounded(10)
    .bg(withAlpha(tint, "1f"))
    .overflow_hidden()
    .children(scene({ ...t, idle: t.idle, waiting: t.waiting }).filter(Boolean));
}
