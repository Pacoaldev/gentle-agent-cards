// Gentle Agent Cards: the agents list as cards, each with the Gentle Shell
// flower that acts out the agent's status. A replacement for the shipped
// `agents` panel, in the spirit of agent-cards.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, run, theme, layout, setAgentOrder, nextCommand, shared, setShared,
  openOverlay, readTextFile, appHome } from "herdr";
import { flowerStage } from "./flower.js";

/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").Element} Element */
/** @typedef {import("herdr").PaneInfo} PaneInfo */
/** @typedef {import("herdr").Program} Program */
/** @typedef {import("herdr").TabInfo} TabInfo */
/** @typedef {Record<string, Color | undefined>} ThemeColors */
/** @typedef {{ id?: string; size?: { px?: number }; children?: LayoutNode[] }} LayoutNode */
/** @typedef {{ address: string; status: string; space_name?: string; focused?: boolean; program?: Program | null; demo?: boolean; pinned?: boolean; machine?: string | null; tab?: string; pane?: string; title?: string; app?: string | null; seq?: number }} CardAgent */
/** @typedef {{ t: Record<string, any>; status: string; depth: number; last: boolean }} SubRow */
/** @typedef {{ name: string; detail: string | null }} CardInfo */
/** @typedef {{ a: CardAgent; info: CardInfo; subs: SubRow[] }} CardEntry */

/**
 * Cast a dynamic theme color or hex concatenation to `Color`.
 * @param {string | undefined} c
 * @returns {Color}
 */
const asColor = (c) => /** @type {Color} */ (c ?? "#888888");

// The mods-hub setting "Needs you first": the agents that need you go to the top,
// and the other cards go to the bottom of the panel, under a line.
const KEY_NEEDS_YOU = "gentle-agent-cards.needsYouFirst";
const needsYouFirst = () => shared(KEY_NEEDS_YOU) === true;
// True when the person turned a kit mod off in the mods-hub: tab-namer off, the cards show no pencil;
// kanban off, no duplicate button.
/** @param {string} name */
const modOff = (name) => { const v = shared("herdr-mods.disabled"); return Array.isArray(v) && v.includes(name); };
const namerOff = () => modOff("tab-namer");
const kanbanOff = () => modOff("kanban");

/**
 * @param {LayoutNode | null | undefined} node
 * @param {string} id
 * @returns {LayoutNode | null}
 */
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar rail goes by its width, as in the shipped `agents` mod.
const narrow = () => (find(/** @type {LayoutNode | null} */ (layout()), "sidebar")?.size?.px ?? Infinity) < 160;

// An agent on another machine has the address "<machine>/<terminal>" (the demo gives `machine`).
/** @param {CardAgent} a */
const machineOf = (a) => a.machine ?? (a.address.includes("/") ? a.address.split("/")[0] : null);
// The color of the machine chip: one hue that no agent status uses.
/** @param {ThemeColors} t */
const remoteColor = (t) => asColor(t.ansi5 || t.accent);

/** @type {Record<string, number>} */
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
/** @type {Record<string, string>} */
const LABEL = { working: "Working", idle: "Sleeping", blocked: "Needs you", done: "Done" };

/** @param {string | null | undefined} s */
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The pane that names a tab: its first agent, else its focused terminal, else its first terminal.
/** @param {PaneInfo[]} all */
function leadPanes(all) {
  /** @type {Map<string, PaneInfo>} */
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

// A tab nobody named takes the agent's own title when the title tells something.
/**
 * @param {TabInfo} tab
 * @param {PaneInfo | undefined} l
 */
function tabTitle(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

/** @param {number} ms */
function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/**
 * @param {Program | null | undefined} p
 * @param {number} size
 * @param {Color} color
 */
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class GentleAgentCards extends View {
  /**
   * @param {import("gpui-shell").Props | undefined} _props
   * @param {AsyncContext} cx
   */
  init(_props, cx) {
    // When each agent last changed its status (ms). Done and idle count as one.
    /** @type {Record<string, { s: string; at: number }>} */
    this.changed = {};
    /** @type {boolean} */
    this.demo = false;
    /** @type {Set<string>} */
    this.demoPins = new Set(["demo-3"]);
    // Cards whose sub-agents are folded.
    /** @type {Set<string>} */
    this.folded = new Set();
    /** @type {string | null} */
    this.hovered = null;
    // The pencil of a card opens the tab-namer dialog, when that mod is installed. The duplicate
    // button opens the duplicate menu of the kanban mod, when that mod is installed.
    /** @type {boolean} */
    this.namer = false;
    /** @type {boolean} */
    this.kanban = false;
    /** @param {string} mod */
    const installed = async (mod) => { try { return Boolean(await readTextFile(`${appHome()}/mods/${mod}/mod.json`)); } catch { return false; } };
    /** @param {AsyncContext} cx */
    const findNamer = (cx) => cx.spawn(async (cx) => {
      const [hasNamer, hasKanban] = [await installed("tab-namer"), await installed("kanban")];
      if (hasNamer !== this.namer || hasKanban !== this.kanban) { this.namer = hasNamer; this.kanban = hasKanban; cx.notify(); }
    });
    findNamer(cx);
    cx.timer.every(60000, (cx) => findNamer(cx));
    cx.timer.every(30000, (cx) => cx.notify());
    // `herdr-app do gentle-agent-cards.demo` shows one example card for each status.
    // `gentle-agent-cards.needs-you` turns "Needs you first" on or off.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "demo") this.demo = !this.demo;
        if (c === "needs-you") setShared(KEY_NEEDS_YOU, !needsYouFirst());
        cx.notify();
      }
    });
  }

  /**
   * @param {number} now
   * @returns {CardEntry[]}
   */
  demoCards(now) {
    /** @param {number} m */
    const ago = (m) => now - m * 60000;
    /** @type {[string, string, string, number][]} */
    const rows = [
      ["blocked", "api-server", "Approve: run migrations?", 3],
      ["done", "web-app", "Fix the login redirect", 12],
      ["working", "herdr-mods", "Gentle agent cards", 1],
      ["idle", "docs", "Release notes", 95],
    ];
    return rows.map(([status, space, tab, m], i) => {
      const address = `demo-${i}`;
      /** @type {CardAgent} */
      const a = { address, status, space_name: space, focused: i === 2, program: null, demo: true, pinned: this.demoPins.has(address), machine: i === 0 ? "build-box" : null };
      this.changed[a.address] = { s: status, at: ago(m) };
      /**
       * @param {number} n
       * @param {string} name
       * @param {string} st
       * @param {number} depth
       * @param {boolean} last
       * @returns {SubRow}
       */
      const kid = (n, name, st, depth, last) => ({ t: { address: `${address}-${n}`, name }, status: st, depth, last });
      const subs = i === 2
        ? [kid(1, "explore: find the panel", "working", 0, false), kid(2, "review: check the diff", "blocked", 0, false), kid(3, "test: run the check", "idle", 1, true)]
        : [];
      return { a, info: { name: space, detail: tab }, subs };
    }).sort((x, y) => (y.a.pinned ? 1 : 0) - (x.a.pinned ? 1 : 0));
  }

  // The header button that turns "Needs you first" on or off.
  /**
   * @param {ThemeColors} t
   * @param {boolean} on
   */
  needsYouButton(t, on) {
    const blocked = asColor(t.blocked);
    const dim = asColor(t.dim);
    return div()
      .id("gac-needs-you")
      .flex_none()
      .p(3)
      .rounded(5)
      .text_color(on ? blocked : dim)
      .when(on, (el) => el.bg(asColor(`${blocked}22`)))
      .cursor_pointer()
      .hover((s) => s.bg(asColor(t.hover)).text_color(on ? blocked : asColor(t.foreground)))
      .tooltip(on ? "Needs you first: on. Click to turn off." : "Needs you first: off. Click to put the agents that need you at the top.")
      .on_click((_e, cx) => {
        setShared(KEY_NEEDS_YOU, !on);
        cx.notify();
      })
      .child(svg("mods/gentle-agent-cards/needs-you.svg").size(13));
  }

  // Live sub-agents of `addr`, depth first. A sub-agent without a pane is not in agents(): take
  // its raw word, with error as blocked. It is never done: it reports to its parent.
  /**
   * @param {Record<string, any>[]} all
   * @param {string} addr
   * @param {number} [depth]
   * @param {Map<string, string>} [listed]
   * @returns {SubRow[]}
   */
  tree(all, addr, depth = 0, listed = new Map()) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const s = listed.get(k.address) ?? k.status;
      const status = s === "error" ? "blocked" : s === "done" ? "idle" : s;
      return [
        { t: k, status, depth, last: i === kids.length - 1 },
        ...this.tree(all, k.address, depth + 1, listed),
      ];
    });
  }

  /**
   * @param {CardAgent[]} list
   * @param {number} now
   */
  track(list, now) {
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s !== s) this.changed[a.address] = { s, at: now };
    }
  }

  // The machine of an agent on another computer: a server icon and the name, in the remote color.
  /**
   * @param {ThemeColors} t
   * @param {string} machine
   * @param {string} key
   */
  machineChip(t, machine, key) {
    const color = remoteColor(t);
    return h_flex()
      .id(`gac-machine-${key}`)
      .flex_none()
      .min_w(0)
      .h(18)
      .px(7)
      .gap(4)
      .rounded(9)
      .items_center()
      .bg(asColor(`${color}26`))
      .border(1)
      .border_color(asColor(`${color}66`))
      .tooltip(`Runs on ${machine}`)
      .child(svg("mods/gentle-agent-cards/server.svg").size(11).flex_none().text_color(color))
      .child(div().truncate().text_size(10.5).font_semibold().text_color(color).child(machine));
  }

  /**
   * @param {ThemeColors} t
   * @param {string} status
   */
  pill(t, status) {
    const color = asColor(t[status] ?? t.dim);
    const text = div().text_size(10.5).font_semibold().text_color(color);
    return h_flex()
      .flex_none()
      .h(18)
      .px(7)
      .rounded(9)
      .items_center()
      .bg(asColor(`${color}22`))
      .child(status === "working"
        ? text.frames(["Working", "Working.", "Working..", "Working..."], 400).child("Working")
        : text.child(LABEL[status] ?? status));
  }

  // A small status mark for a sub-agent row.
  /**
   * @param {ThemeColors} t
   * @param {string} status
   */
  mark(t, status) {
    const blocked = asColor(t.blocked);
    if (status === "working") return svg("mods/gentle-agent-cards/spinner.svg").size(11).flex_none().text_color(asColor(t.working)).spin(900);
    if (status === "blocked") return div().size(13).flex_none().rounded(4).bg(asColor(`${blocked}26`)).text_size(10).font_bold()
      .text_color(blocked).flex().items_center().justify_center().child("!");
    if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(asColor(t.idle ?? t.dim));
    return div().size(7).mx(3).flex_none().rounded(4).bg(asColor(t[status] ?? t.dim));
  }

  // The pin button: shown while the pointer is on the card, or always when the card is pinned.
  /**
   * @param {ThemeColors} t
   * @param {CardAgent} a
   */
  pin(t, a) {
    return div()
      .id(`gac-pin-${a.address}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(asColor(a.pinned ? t.accent : t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(asColor(t.hover)).text_color(asColor(t.foreground)))
      .tooltip(a.pinned ? "Unpin" : "Pin to the top")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (a.demo) this.demoPins.has(a.address) ? this.demoPins.delete(a.address) : this.demoPins.add(a.address);
        else run("terminal.pin", { terminal: a.address, pinned: !a.pinned });
        this.hovered = null;
        cx.notify();
      })
      .child(svg(`mods/gentle-agent-cards/${a.pinned && this.hovered === a.address ? "pin-off" : "pin"}.svg`).size(13));
  }

  // The pencil button: shown while the pointer is on the card. It opens the tab-namer dialog for the agent's tab.
  /**
   * @param {ThemeColors} t
   * @param {CardAgent} a
   */
  rename(t, a) {
    return div()
      .id(`gac-rename-${a.address}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(asColor(t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(asColor(t.hover)).text_color(asColor(t.foreground)))
      .tooltip("Rename the tab")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!a.demo) openOverlay({ mod: "tab-namer", kind: "dialog", width: 460, props: { tab: a.tab, terminal: a.address } });
      })
      .child(svg("mods/gentle-agent-cards/pencil.svg").size(13));
  }

  // The duplicate button: shown while the pointer is on the card. It opens the duplicate menu of the
  // kanban mod at the pointer: a new session of the same agent in this space, or in a new worktree.
  /**
   * @param {ThemeColors} t
   * @param {CardAgent} a
   */
  duplicate(t, a) {
    return div()
      .id(`gac-clone-${a.address}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(asColor(t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(asColor(t.hover)).text_color(asColor(t.foreground)))
      .tooltip("Duplicate this agent")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (a.demo) return;
        const name = a.space_name || a.program?.name || a.app || "Agent";
        openOverlay({
          mod: "kanban", kind: "popup", width: 270, height: 5 * 2 + 26 + 2 * 32,
          props: { part: "clone-menu", title: `Duplicate ${name}`, address: a.address },
        });
      })
      .child(svg("mods/gentle-agent-cards/copy.svg").size(13));
  }

  // The sub-agents of a card: a header that folds them, then one row for each.
  /**
   * @param {ThemeColors} t
   * @param {CardAgent} a
   * @param {SubRow[]} subs
   */
  subs(t, a, subs) {
    const open = !this.folded.has(a.address);
    const top = subs.reduce((/** @type {string | null} */ m, s) => ((RANK[s.status] ?? 0) > (m ? (RANK[m] ?? 0) : 0) ? s.status : m), null);
    const header = h_flex()
      .id(`gac-subs-${a.address}`)
      .h(22)
      .px(4)
      .gap(6)
      .rounded(6)
      .items_center()
      .text_size(11)
      .text_color(asColor(t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(asColor(t.hover)).text_color(asColor(t.foreground)))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (open) this.folded.add(a.address);
        else this.folded.delete(a.address);
        cx.notify();
      })
      .child(svg(`mods/gentle-agent-cards/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().flex_1().child(`${subs.length} sub-agent${subs.length === 1 ? "" : "s"}`))
      .when(!open && Boolean(top), (el) => el.child(this.mark(t, top ?? "idle")));
    /** @param {SubRow} s */
    const row = (s) => {
      const subIcon = icon(s.t.program, 12, asColor(t.foreground));
      return h_flex()
        .id(`gac-sub-${s.t.address}`)
        .h(22)
        .pl(4 + s.depth * 14)
        .pr(4)
        .gap(6)
        .rounded(6)
        .items_center()
        .text_size(11.5)
        .cursor_pointer()
        .hover((el) => el.bg(asColor(t.hover)))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (!a.demo) run("terminal.peek", { terminal: s.t.address });
        })
        .child(div().flex_none().text_color(asColor(t.input)).child(s.last ? "└" : "├"))
        .when(Boolean(subIcon), (el) => subIcon ? el.child(subIcon) : el)
        .child(div().flex_1().min_w(0).truncate().text_color(asColor(t.muted)).child(s.t.name || s.t.template || s.t.program?.name || s.t.address))
        .child(this.mark(t, s.status));
    };
    return v_flex().pt(4).mt(6).border_t(1).border_color(asColor(t.border))
      .child(header)
      .when(open, (el) => el.children(subs.map(row)));
  }

  /**
   * @param {ThemeColors} t
   * @param {CardAgent} a
   * @param {CardInfo} info
   * @param {number} now
   * @param {SubRow[]} [subs]
   */
  card(t, a, info, now, subs = []) {
    const since = this.changed[a.address]?.at;
    const machine = machineOf(a);
    const border = asColor(a.status === "blocked" ? `${t.blocked}99` : a.focused ? t.accent : machine ? `${remoteColor(t)}88` : t.border);
    const hovered = this.hovered === a.address;
    const progIcon = icon(a.program, 14, asColor(t.foreground));
    return v_flex()
      .id(`gac-card-${a.address}`)
      .flex_none()
      .p(8)
      .rounded(12)
      .bg(asColor(a.focused ? t.selected : t.surface))
      .border(1)
      .border_color(border)
      .cursor_pointer()
      .hover((s) => s.bg(asColor(t.hover)))
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => a.pane && run("pane.focus", { pane: a.pane }))
      .child(h_flex().gap(10).items_center()
        .child(flowerStage(t, a.status))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(6).items_center()
            .when(Boolean(progIcon), (el) => progIcon ? el.child(progIcon) : el)
            .child(div().flex_1().min_w(0).truncate().font_medium().text_color(asColor(a.status === "idle" ? t.muted : t.foreground)).child(info.name))
            .when(Boolean(since) && !hovered, (el) => el.child(div().flex_none().text_size(11).text_color(asColor(t.dim)).child(duration(now - (since ?? now)))))
            .when(hovered && this.namer && !namerOff(), (el) => el.child(this.rename(t, a)))
            .when(hovered && this.kanban && !kanbanOff(), (el) => el.child(this.duplicate(t, a)))
            .when(hovered || Boolean(a.pinned), (el) => el.child(this.pin(t, a))))
          .when(Boolean(info.detail), (el) => el.child(div().truncate().text_size(11.5).text_color(asColor(t.dim)).child(info.detail ?? "")))
          .child(h_flex().gap(6).items_center()
            .child(this.pill(t, a.status))
            .when(Boolean(machine), (el) => el.child(div().flex_1()).child(this.machineChip(t, machine ?? "", a.address))))))
      .when(subs.length > 0, (el) => el.child(this.subs(t, a, subs)));
  }

  // The rail: a number and a status dot for each agent.
  /**
   * @param {ThemeColors} t
   * @param {CardAgent} a
   * @param {number} i
   */
  railRow(t, a, i) {
    const color = asColor(t[a.status] ?? t.dim);
    return h_flex()
      .id(`gac-rail-${a.address}`)
      .h(26)
      .px(8)
      .flex_none()
      .items_center()
      .gap(4)
      .hover((s) => s.bg(asColor(t.hover)))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(machineOf(a)), (el) => el.child(svg("mods/gentle-agent-cards/server.svg").size(10).flex_none().text_color(remoteColor(t))))
      .child(div().flex_1().text_right().text_color(asColor(t.muted)).child(String(i + 1)))
      .child(div().size(8).flex_none().rounded(4).bg(color)
        .when(a.status === "working" || a.status === "blocked", (el) => el.loop("opacity", { from: 0.3, to: 1, period: 900 })));
  }

  /** @param {Context} _cx */
  render(_cx) {
    // "Waiting" has no theme color of its own here: the flower scene takes dim.
    const t = /** @type {ThemeColors} */ (theme());
    const now = Date.now();
    /** @type {CardAgent[]} */
    const list = [...agents()];
    this.track(list, now);
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const subsOf = new Map(list.map((a) => [a.address, this.tree(all, a.address, 0, this.listed)]));
    // A card ranks by its most urgent status, its sub-agents included.
    const urgency = new Map(list.map((a) => [a.address, Math.max(RANK[a.status] ?? 0, ...(subsOf.get(a.address) ?? []).map((s) => RANK[s.status] ?? 0))]));
    /** @param {CardAgent} a */
    const since = (a) => this.changed[a.address]?.at ?? 0;
    const first = needsYouFirst();
    /** @param {CardAgent} a */
    const top = (a) => (first && a.status === "blocked" ? 1 : 0);
    list.sort((x, y) => top(y) - top(x) || (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) || (urgency.get(y.address) ?? 0) - (urgency.get(x.address) ?? 0) || since(y) - since(x) || (y.seq ?? 0) - (x.seq ?? 0));
    setAgentOrder(list.map((a) => a.address));

    if (narrow()) {
      return v_flex().size_full().min_h(0).bg(asColor(t.chrome)).border_t(1).border_color(asColor(t.border)).text_size(13)
        .child(v_flex().id("gac-rail").flex_1().min_h(0).overflow_y_scrollbar().children(list.map((a, i) => this.railRow(t, a, i))));
    }

    // Each card reads its space as the name and its tab (or the agent's title) as the detail.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tabTitle(tab, leads.get(tab.id))]));
    /**
     * @param {CardAgent} a
     * @returns {CardInfo}
     */
    const infoOf = (a) => {
      const tab = (a.tab ? tabs.get(a.tab) : undefined) ?? (a.title || a.program?.name || "");
      return { name: a.space_name || tab || a.address, detail: /^\d+$/.test(tab) ? a.program?.name ?? null : tab };
    };
    const busy = list.filter((a) => a.status !== "idle").length;
    /** @type {CardEntry[]} */
    const cards = this.demo ? this.demoCards(now) : list.map((a) => ({ a, info: infoOf(a), subs: subsOf.get(a.address) ?? [] }));
    /** @param {CardEntry} c */
    const draw = (c) => this.card(t, c.a, c.info, now, c.subs);
    // "Needs you first": the blocked cards at the top, a space that grows, a line,
    // and the other cards at the bottom of the panel.
    const body = !first ? cards.map(draw) : (() => {
      const needs = cards.filter((c) => c.a.status === "blocked");
      const rest = cards.filter((c) => c.a.status !== "blocked");
      return [
        ...needs.map(draw),
        div().id("gac-spacer").flex_1(),
        ...(needs.length && rest.length ? [h_flex().id("gac-divider").flex_none().mx(4).gap(8).items_center()
          .child(div().flex_1().h(1).bg(asColor(t.input)))
          .child(div().flex_none().text_size(10.5).font_medium().text_color(asColor(t.dim)).child("Other agents"))
          .child(div().flex_1().h(1).bg(asColor(t.input)))] : []),
        ...rest.map(draw),
      ];
    })();

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(asColor(t.chrome))
      .border_t(1)
      .border_color(asColor(t.border))
      .text_size(13)
      .child(h_flex().px(16).h(41).pt(14).pb(5).flex_none().items_center().justify_between()
        .child(div().text_size(11.5).font_medium().text_color(asColor(t.dim)).child("Agents"))
        .child(h_flex().gap(6).items_center()
          .child(div().text_size(11).text_color(asColor(this.demo ? t.accent : t.dim))
            .child(this.demo ? "Demo" : list.length ? `${busy} active · ${list.length}` : ""))
          .child(this.needsYouButton(t, first))))
      .when(cards.length === 0, (el) => el.child(div().px(16).text_size(12).text_color(asColor(t.dim))
        .child("No agents yet. Agents show up here when they report their status.")))
      .child(v_flex().id("gac-list").flex_1().min_h(0).px(10).pb(10).gap(8).overflow_y_scrollbar()
        .children(body));
  }
}
