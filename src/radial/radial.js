"use strict";
/* global rapi, rt */
// Radial pie menu: inner ring = categories, outer rings = sub-options (nested as deep as the menu goes).
const C = 360;
const RINGS = [
  [64, 150],
  [156, 236],
  [242, 316],
  [322, 352],
];
const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("wheel");
const hint = document.getElementById("hint");
let state = { items: [], lang: "en", count: 0, kinds: [] };
let path = []; // path[k] = index chosen in ring k
let focusLevel = 0;
let busy = false;
// Smooth transitions: the DOM is rebuilt on every render, so we remember what was highlighted / shown last time and animate the difference
// (orange fades in on the new slice and out of the old one; the hub text cross-fades).
let hubHover = false,
  leaveT = null,
  prevOn = new Set(),
  prevHubKey = null,
  prevHubHot = false;
const T = (k, v) => rt(state.lang, k, v);
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const pol = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
function sector(r1, r2, a0, a1) {
  const g = 0.012;
  a0 += g;
  a1 -= g;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pol(r2, a0),
    [x1, y1] = pol(r2, a1),
    [x2, y2] = pol(r1, a1),
    [x3, y3] = pol(r1, a0);
  return `M${x0},${y0} A${r2},${r2} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r1},${r1} 0 ${big} 0 ${x3},${y3} Z`;
}
function layout(items, level, parentMid, parentSpan) {
  const n = items.length;
  if (!n) return [];
  if (level === 0) {
    const span = (Math.PI * 2) / n;
    return items.map((it, i) => ({
      it,
      a0: -Math.PI / 2 - span / 2 + i * span,
      a1: -Math.PI / 2 + span / 2 + i * span,
    }));
  }
  const per =
    Math.max(0.36, Math.min(0.62, (Math.PI * 1.6) / n)) *
    (level >= 2 ? 0.82 : 1);
  const total = per * n;
  const start = parentMid - total / 2;
  return items.map((it, i) => ({
    it,
    a0: start + i * per,
    a1: start + (i + 1) * per,
  }));
}
function label(it) {
  const s = T(it.label);
  return s;
}
// Rings get the "pop" entrance animation only when they first appear (keyed by level + chosen path), never on a
// plain re-render. Re-animating every render made the wheel fade out/in on every hover (the v1.2.0 flicker).
let shownRings = new Set();
let renders = [];
let loopLogged = false;
let renderCount = 0;
function render() {
  renderCount++;
  const now = performance.now();
  renders.push(now);
  while (renders.length && now - renders[0] > 1000) renders.shift();
  if (renders.length > 25 && !loopLogged) {
    loopLogged = true;
    rapi.send("radial:log", { warn: "render-loop", perSecond: renders.length });
  }
  const oldTxt = svg.querySelector(".ctr .hubtxt");
  const curOn = new Set();
  svg.replaceChildren();
  let items = state.items;
  let parentMid = -Math.PI / 2,
    parentSpan = Math.PI * 2;
  const live = new Set();
  for (let level = 0; level < RINGS.length && items && items.length; level++) {
    const rk = level + ":" + path.slice(0, level).join(".");
    live.add(rk);
    const g = el(
      "g",
      {
        class:
          `ring r${level + 1}` +
          (shownRings.has(rk) && !state.legacyHover ? " still" : ""),
      },
      svg,
    );
    const [r1, r2] = RINGS[level];
    const lay = layout(items, level, parentMid, parentSpan);
    lay.forEach(({ it, a0, a1 }, i) => {
      const on = path[level] === i;
      const sk = rk + "/" + i;
      if (on) curOn.add(sk);
      const fx =
        state.legacyHover || it.disabled
          ? ""
          : on && !prevOn.has(sk)
            ? " fx-in"
            : !on && prevOn.has(sk)
              ? " fx-out"
              : "";
      const s = el(
        "g",
        {
          class:
            "sl" +
            (on ? " on" : "") +
            fx +
            (it.disabled ? " dis" : "") +
            (it.children ? "" : " leaf"),
          "data-level": level,
          "data-i": i,
          role: "menuitem",
        },
        g,
      );
      el("path", { d: sector(r1, r2, a0, a1) }, s);
      const mid = (a0 + a1) / 2;
      const rm = (r1 + r2) / 2;
      const narrow = (a1 - a0) * rm < 70;
      const [cx, cy] = pol(rm, mid);
      const ic = el(
        "text",
        { class: "ic", x: cx, y: cy - (level ? 9 : 11) },
        s,
      );
      ic.textContent = it.icon || "•";
      const tx = el("text", { x: cx, y: cy + (level ? 11 : 13) }, s);
      let lab = label(it);
      const maxc = narrow ? 9 : level ? 12 : 14;
      if (lab.length > maxc) lab = lab.slice(0, maxc - 1) + "…";
      tx.textContent =
        lab + (it.children ? (state.lang === "ar" ? " ‹" : " ›") : "");
      if (level === focusLevel && i < 9) {
        const [kx, ky] = pol(r2 - 8, a0 + 0.07);
        const kb = el("text", { class: "kb", x: kx, y: ky }, s);
        kb.textContent = i + 1;
      }
      s.addEventListener("mouseenter", () => hover(level, i));
      s.addEventListener("click", (e) => {
        e.stopPropagation();
        activate(level, i);
      });
      const tt = el("title", {}, s);
      tt.textContent =
        label(it) + (it.disabled ? " — " + T("readerMissing") : "");
    });
    const sel = path[level];
    if (sel == null || !items[sel] || !items[sel].children) break;
    parentMid = (lay[sel].a0 + lay[sel].a1) / 2;
    parentSpan = lay[sel].a1 - lay[sel].a0;
    items = items[sel].children;
  }
  shownRings = live;
  prevOn = curOn;
  // Hub: shows the hovered / chosen slice, but when the pointer is ON the hub (or nothing is chosen) it shows the app: logo + "Zest".
  const cur = hubHover ? null : current();
  const hubKey = cur ? cur.id || cur.label : "app";
  const changed = prevHubKey !== null && hubKey !== prevHubKey;
  const ctr = el(
    "g",
    {
      class:
        "ctr" +
        (hubHover ? " hot" : "") +
        (hubHover && !prevHubHot ? " fx-hot" : "") +
        (!hubHover && prevHubHot ? " fx-cold" : ""),
      role: "button",
    },
    svg,
  );
  el("circle", { cx: C, cy: C, r: 56 }, ctr);
  const hub = el("g", { class: "hubtxt" + (changed ? " fade" : "") }, ctr);
  if (cur) {
    const t0 = el("text", { class: "logo", x: C, y: C - 18 }, hub);
    t0.textContent = cur.icon || "•";
  } else
    el(
      "image",
      {
        class: "logoimg",
        href: "icon.png",
        x: C - 19,
        y: C - 49,
        width: 38,
        height: 38,
      },
      hub,
    );
  const t1 = el("text", { class: "t1", x: C, y: C + 8 }, hub);
  t1.textContent = cur ? trunc(label(cur), 13) : "Zest";
  const t2 = el("text", { class: "t2", x: C, y: C + 25 }, hub);
  t2.textContent =
    state.count === 1 ? T("file") : T("files", { n: state.count });
  if (changed && oldTxt) {
    const ghost = oldTxt.cloneNode(true);
    ghost.setAttribute("class", "hubtxt ghost");
    ctr.appendChild(ghost);
    setTimeout(() => ghost.remove(), 260);
  }
  prevHubKey = hubKey;
  prevHubHot = hubHover;
  ctr.addEventListener("click", (e) => {
    e.stopPropagation();
    close(false, "center-click");
  });
  ctr.addEventListener("mouseenter", () => {
    clearTimeout(leaveT);
    clearTimeout(hoverT);
    if (!hubHover) {
      hubHover = true;
      render();
    }
  });
  ctr.addEventListener("mouseleave", () => {
    clearTimeout(leaveT);
    leaveT = setTimeout(() => {
      if (hubHover) {
        hubHover = false;
        render();
      }
    }, 60);
  });
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function nodeAt(level, i) {
  let items = state.items;
  for (let k = 0; k < level; k++) items = items[path[k]].children;
  return items[i];
}
function ringItems(level) {
  let items = state.items;
  for (let k = 0; k < level; k++) {
    if (path[k] == null) return [];
    items = items[path[k]].children || [];
  }
  return items;
}
function current() {
  let items = state.items,
    node = null;
  for (let k = 0; k < path.length; k++) {
    if (path[k] == null || !items) break;
    node = items[path[k]];
    items = node && node.children;
  }
  return node;
}
let hoverT = null;
const isCurrent = (level, i) =>
  path[level] === i &&
  focusLevel === level &&
  (path.length === level + 1 || path[level + 1] == null);
function hover(level, i) {
  // (state.legacyHover reproduces the v1.2.0 behaviour; CI uses it as a negative control for the flicker probe)
  clearTimeout(leaveT);
  clearTimeout(hoverT);
  const wasHub = hubHover;
  hubHover = false; // leaving the hub for a slice: the hub shows that slice again
  if (!state.legacyHover && !wasHub && isCurrent(level, i)) return;
  hoverT = setTimeout(
    () => {
      if (!state.legacyHover && !wasHub && isCurrent(level, i)) return;
      path = path.slice(0, level);
      path[level] = i;
      focusLevel = level;
      render();
    },
    level === 0 ? 0 : 40,
  );
}
function activate(level, i) {
  const it = nodeAt(level, i);
  if (!it || it.disabled || busy) return;
  path = path.slice(0, level);
  path[level] = i;
  if (it.children) {
    focusLevel = level + 1;
    path[level + 1] = 0;
    render();
    return;
  }
  busy = true;
  render();
  rapi.send("radial:pick", { id: it.id, action: it.action, label: label(it) });
  close(true);
}
function close(picked, reason) {
  if (document.body.classList.contains("closing")) return;
  document.body.classList.add("closing");
  setTimeout(() => {
    rapi.send("radial:close", { picked: !!picked, reason: reason || "close" });
    document.body.classList.remove("closing");
  }, 130);
}
document.addEventListener("click", () => close(false, "outside-click"));
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  close(false, "right-click");
});
document.addEventListener("keydown", (e) => {
  hubHover = false;
  const items = ringItems(focusLevel);
  const n = items.length;
  let i = path[focusLevel];
  const rtl = state.lang === "ar";
  if (e.key === "Escape") {
    if (focusLevel > 0) {
      path = path.slice(0, focusLevel);
      focusLevel--;
      render();
    } else close(false, "escape");
    return;
  }
  if (
    e.key === "Backspace" ||
    (e.key === (rtl ? "ArrowRight" : "ArrowLeft") && e.shiftKey)
  ) {
    if (focusLevel > 0) {
      path = path.slice(0, focusLevel);
      focusLevel--;
      render();
    }
    return;
  }
  if (!n) return;
  if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "Tab") {
    e.preventDefault();
    i = i == null ? 0 : (i + 1) % n;
    path = path.slice(0, focusLevel);
    path[focusLevel] = i;
    render();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    i = i == null ? n - 1 : (i - 1 + n) % n;
    path = path.slice(0, focusLevel);
    path[focusLevel] = i;
    render();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    activate(focusLevel, i == null ? 0 : i);
  } else if (/^[1-9]$/.test(e.key) && +e.key <= n)
    activate(focusLevel, +e.key - 1);
});
rapi.on("radial:show", (d) => {
  if (d.update && state.items.length) {
    const keep = path.slice(),
      fl = focusLevel;
    state = d;
    path = keep.filter((x) => x != null);
    focusLevel = Math.min(fl, path.length ? path.length - 1 : 0);
    try {
      render();
    } catch (_) {
      path = [];
      focusLevel = 0;
      render();
    }
    return;
  }
  shownRings = new Set();
  loopLogged = false;
  document.body.classList.remove("closing");
  prevOn = new Set();
  prevHubKey = null;
  prevHubHot = false;
  hubHover = false;
  clearTimeout(leaveT);
  state = d;
  path = [];
  focusLevel = 0;
  busy = false;
  document.documentElement.dir = d.lang === "ar" ? "rtl" : "ltr";
  hint.textContent = T("hint");
  if (d.preselect) {
    path = d.preselect.slice();
    focusLevel = Math.max(0, path.length - 1);
  }
  render();
});
// Render-rate telemetry for wheel.log: a steady wheel renders only when the selection changes.
let lastStat = 0;
setInterval(() => {
  if (!state.items.length || document.body.classList.contains("closing"))
    return;
  const n = renderCount - lastStat;
  lastStat = renderCount;
  if (n)
    rapi.send("radial:log", { stat: "renders", last2s: n, total: renderCount });
}, 2000);
window.__radial = {
  get hubHover() {
    return hubHover;
  },
  get state() {
    return state;
  },
  get path() {
    return path;
  },
  get renders() {
    return renderCount;
  },
  activate,
  hover: (l, i) => {
    hubHover = false;
    path = path.slice(0, l);
    path[l] = i;
    focusLevel = l;
    render();
  },
};
