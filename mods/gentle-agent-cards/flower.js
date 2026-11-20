// The Gentle Shell rose: the brand rose image acting out each agent status.
// All motion is native (`loop`): no timer redraws the mod. The rose asset is
// `docs/assets/brand/rose.png` of Gentle-AI (200x261, transparent).

import { div, image } from "gpui-kit";

export const STAGE = 64;

// The rose's own hue when the theme has no color for a status.
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

// An element at a fixed spot in the stage.
const at = (el, x, y) => el.absolute().left(x).top(y);

// Soft halo on the bloom: pinned with `left`/`top` (loops on position stay at 0,0
// until the first tick — reads as a disc growing from the corner). Size + opacity
// loop only. Two discs: a small bright core and a wide dim one, like `pet.js`.
function halo(tint, d1, d2, period, opacity = 0.14) {
  const disc = (a, b, op) => div()
    .w(a)
    .h(a)
    .rounded(b / 2)
    .bg(tint)
    .loop("width", { from: a, to: b, period })
    .loop("height", { from: a, to: b, period })
    .loop("opacity", { from: op * 0.5, to: op, period });
  // A mist, not a stain: two wide discs out of phase read as one soft glow.
  return div()
    .absolute()
    .left(0).top(0).w(STAGE).h(STAGE)
    .children([
      at(disc(d1 * 1.2, d2 * 1.2, opacity), HALO_CX - d1 * 0.6, HALO_CY - d1 * 0.6),
      at(disc(d1 * 0.8, d2 * 0.8, opacity * 1.3), HALO_CX - d1 * 0.4, HALO_CY - d1 * 0.4),
    ]);
}

// The rose image, lifted by the status motion (`motion`: a `top` loop).
// Drawn 3px below the top of the stage, matching the halo's +3 anchor offset.
function rose(motion) {
  const r = at(image("mods/gentle-agent-cards/rose.png").w(ROSE_W).h(ROSE_H), roseLeft, roseTop + 3);
  const g = div().absolute().left(0).w(STAGE).h(STAGE).children([r]);
  return motion ? g.loop("top", motion) : g.top(0);
}

// Keeps a breathing halo on the bloom while the rose bobs in the same wrapper.
const withBob = (el, motion) =>
  motion
    ? div().absolute().left(0).w(STAGE).h(STAGE).children([el]).loop("top", motion)
    : el;

// A "z" that rises and fades, as the robot style does it.
const zzz = (t, x, size, period, from, to) =>
  div().absolute().left(x).text_size(size).font_bold().text_color(t.muted)
    .loop("top", { from, to, period, easing: "linear" })
    .child(div().loop("opacity", { from: 0, to: 0.9, period: period / 2 }).child("z"));

// The ground line every scene stands on.
const ground = (t, color) => at(div().w(48).h(2.5).rounded(1).bg(color + "77"), 8, 58);

// Working: the rose bobs gently while its halo breathes.
function working(t) {
  const c = t.working;
  const bob = { from: 0, to: 1.5, period: 900 };
  return [
    withBob(halo(c, 34, 44, 1800, 0.15), bob),
    ground(t, c),
    rose(bob),
  ];
}

// Sleeping: a slow breath, a dim halo and three "z".
function idle(t) {
  const c = t.idle ?? t.dim;
  const bob = { from: 0, to: 2, period: 3200 };
  return [
    withBob(halo(c, 34, 46, 3400, 0.1), bob),
    ground(t, c),
    rose(bob),
    zzz(t, 48, 9, 2600, 16, 4),
    zzz(t, 53, 11, 3100, 10, -4),
    zzz(t, 43, 8, 3700, 4, -8),
  ];
}

// Needs you: the halo pulses fast in the blocked color and the rose shakes.
function blocked(t) {
  const c = t.blocked;
  return [
    halo(c, 42, 54, 500, 0.3),
    ground(t, c),
    rose(null).loop("left", { from: roseLeft - 1, to: roseLeft + 1, period: 260, easing: "linear" }),
  ];
}

// Done: the rose jumps and its halo blooms wide.
function done(t) {
  const c = t.done;
  const bob = { from: 0, to: -5, period: 700 };
  return [
    withBob(halo(c, 38, 50, 1400, 0.16), bob),
    ground(t, c),
    rose(bob),
  ];
}

// Waiting: the rose sways while a drop falls over it.
function waiting(t) {
  const c = t.waiting ?? t.dim;
  const bob = { from: 0, to: 0.5, period: 2400 };
  return [
    withBob(halo(c, 34, 46, 2400, 0.12), bob),
    ground(t, c),
    rose(bob),
    at(div().w(4).h(6).rounded(2).bg(c)
      .loop("top", { from: 2, to: roseTop + 6, period: 1400, easing: "linear" })
      .loop("opacity", { from: 0, to: 0.9, period: 700 }), roseLeft + ROSE_W / 2 - 2, 0),
  ];
}

const SCENES = { working, idle, blocked, done, waiting };

// The 64px stage of one card: the tint of the status behind, the rose in front.
export function flowerStage(t, status) {
  const tint = t[status] ?? ROSE;
  const scene = SCENES[status] ?? idle;
  return div()
    .relative()
    .flex_none()
    .w(STAGE)
    .h(STAGE)
    .rounded(10)
    .bg(tint + "1f")
    .overflow_hidden()
    .children(scene({ ...t, idle: t.idle, waiting: t.waiting }).filter(Boolean));
}
