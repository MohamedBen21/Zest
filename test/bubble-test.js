"use strict";
// Quick bubble-only test: ZEST_RADIAL_SCRIPT=test/bubble-test.js (see package.json "test:bubble")
const { ipcMain } = require("electron");
module.exports = async ({ controller }) => {
  const lines = [];
  let passed = 0,
    failed = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (n, c, x = "") => {
    c ? passed++ : failed++;
    lines.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);
  };
  const W = () => controller._windows();
  const until = async (fn, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (_) {}
      await sleep(100);
    }
    return null;
  };
  const live = () => {
    const b = W().bubble;
    return b && !b.isDestroyed() ? b : null;
  };
  controller._set({ bubbleSize: "M", bubbleMini: false, bubblePos: null });
  controller.showBubble();
  const b = await until(() => live() && live().isVisible() && live());
  ok("bubble opens", !!b);
  if (!b) return { passed, failed, lines };
  const full = b.getBounds();
  ok(
    "bubble is a square",
    full.width === full.height,
    `${full.width}x${full.height}`,
  );
  // --- drag: size never changes ---
  const [x0, y0] = b.getPosition();
  const ev = { sender: b.webContents };
  ipcMain.emit("bubble:dragstart", ev);
  for (let i = 1; i <= 30; i++)
    ipcMain.emit("bubble:move", ev, { dx: i * 3.37, dy: i * 1.61 }); // fractional offsets like a 125 %/150 % display
  const mid = b.getBounds();
  ipcMain.emit("bubble:moved", ev);
  const end = b.getBounds();
  ok(
    "dragging with fractional offsets does not throw and keeps the exact size",
    mid.width === full.width &&
      mid.height === full.height &&
      end.width === full.width &&
      end.height === full.height,
    `${full.width}→${mid.width}→${end.width}`,
  );
  ok(
    "window follows the pointer",
    mid.x === x0 + 101 && mid.y === y0 + 48,
    `+${mid.x - x0},+${mid.y - y0}`,
  );
  // --- three remembered sizes ---
  const sizes = {};
  for (const k of ["S", "M", "L"]) {
    ipcMain.emit("bubble:size", ev, k);
    await sleep(200);
    const r = b.getBounds();
    sizes[k] = r.width;
    if (r.width !== r.height) sizes[k] = -1;
  }
  ok(
    "three distinct square sizes S < M < L",
    sizes.S > 0 && sizes.S < sizes.M && sizes.M < sizes.L,
    JSON.stringify(sizes),
  );
  ipcMain.emit("bubble:size", ev, "L");
  await sleep(200);
  ok(
    "chosen size is remembered in settings",
    controller._settings().bubbleSize === "L",
    controller._settings().bubbleSize,
  );
  controller.hideBubble();
  await sleep(500);
  controller.showBubble();
  const b2 = await until(() => live() && live().isVisible() && live());
  ok(
    "a new bubble opens at the remembered size",
    !!b2 && b2.getBounds().width === sizes.L,
    b2 ? `${b2.getBounds().width}px` : "no window",
  );
  // --- the minus button hides it (slides back into the tray corner) ---
  const ev2 = { sender: b2.webContents };
  ipcMain.emit("bubble:minimize", ev2);
  await sleep(700);
  ok(
    "the – button makes the bubble go away",
    !live() && controller._settings().bubble === false,
  );
  // --- summon like the tray icon does: fly out, then dismiss ---
  controller.toggleBubble("tray");
  const b3 = await until(() => live() && live().isVisible() && live());
  await sleep(600);
  ok(
    "tray click summons the bubble (slides out of the tray corner)",
    !!b3 && b3.getBounds().width === sizes.L && b3.getOpacity() > 0.95,
    b3 ? `${b3.getBounds().width}px, opacity ${b3.getOpacity()}` : "no window",
  );
  controller.toggleBubble("tray");
  await sleep(700);
  ok("tray click again hides it", !live());
  controller.toggleBubble("cursor");
  const b4 = await until(() => live() && live().isVisible() && live());
  await sleep(400);
  ok("hotkey summons it under the cursor", !!b4);
  // --- wheel from a bubble parked in the screen corner: wheel fully on screen, bubble returns home afterwards ---
  controller.hideBubble();
  await sleep(400);
  const { screen } = require("electron");
  const os = require("os"),
    path = require("path"),
    fs = require("fs");
  const sharp = require("sharp");
  const img = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "zest-bub-")),
    "photo.jpg",
  );
  await sharp({
    create: { width: 200, height: 120, channels: 3, background: "#ff7a00" },
  })
    .jpeg()
    .toFile(img);
  const wa = screen.getPrimaryDisplay().workArea;
  const sz = 76;
  const corner = { x: wa.x + wa.width - sz - 4, y: wa.y + wa.height - sz - 4 };
  controller._set({ bubbleSize: "M", bubblePos: corner });
  controller.showBubble();
  const b5 = await until(() => live() && live().isVisible() && live());
  await sleep(300);
  const home = b5.getBounds();
  ipcMain.emit("bubble:drop", { sender: b5.webContents }, [img]);
  const rad = await until(
    () =>
      W().radial &&
      !W().radial.isDestroyed() &&
      W().radial.isVisible() &&
      W().radial,
    6000,
  );
  await sleep(500);
  if (rad) {
    const rb = rad.getBounds(),
      bb = b5.getBounds();
    ok(
      "wheel opened from a corner bubble stays completely on screen",
      rb.x >= wa.x &&
        rb.y >= wa.y &&
        rb.x + 720 <= wa.x + wa.width &&
        rb.y + 720 <= wa.y + wa.height,
      JSON.stringify(rb),
    );
    ok(
      "the bubble rides to the wheel hub while it is open",
      Math.abs(bb.x + bb.width / 2 - (rb.x + 360)) <= 2 &&
        Math.abs(bb.y + bb.height / 2 - (rb.y + 360)) <= 2,
      `bubble centre ${bb.x + bb.width / 2},${bb.y + bb.height / 2} vs hub ${rb.x + 360},${rb.y + 360}`,
    );
    controller.hideRadial("test");
    await sleep(600);
    const after = b5.getBounds();
    ok(
      "when the wheel closes the bubble goes back to where it was put",
      after.x === home.x && after.y === home.y,
      `home ${home.x},${home.y} → ${after.x},${after.y}`,
    );
  } else ok("wheel opens from the bubble drop", false);
  // --- the bubble refuses to sit on top of desktop icons: it vibrates, then glides back to where it was ---
  controller.hideBubble();
  await sleep(500);
  const icon = { x: wa.x + 500, y: wa.y + 200, width: 90, height: 100 };
  let desktopVisible = true;
  controller._setProbe({
    warm() {},
    stop() {},
    rects: async () => [icon],
    topIsDesktop: async () => desktopVisible,
  });
  const start = { x: wa.x + 200, y: wa.y + 200 };
  controller._set({ bubbleSize: "M", bubblePos: start });
  controller.showBubble();
  const b6 = await until(() => live() && live().isVisible() && live());
  await sleep(300);
  const ev6 = { sender: b6.webContents };
  const drag = async (dx, dy) => {
    ipcMain.emit("bubble:dragstart", ev6);
    ipcMain.emit("bubble:move", ev6, {
      dx: Math.round(dx / 2),
      dy: Math.round(dy / 2),
    });
    ipcMain.emit("bubble:move", ev6, { dx, dy });
    ipcMain.emit("bubble:moved", ev6);
  };
  await drag(310, 10);
  const xs = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 1600) {
    xs.push(b6.getBounds().x);
    await sleep(20);
  }
  let flips = 0;
  for (let i = 2; i < xs.length; i++) {
    const a = xs[i - 1] - xs[i - 2],
      c = xs[i] - xs[i - 1];
    if (a && c && Math.sign(a) !== Math.sign(c)) flips++;
  }
  const endB = b6.getBounds();
  ok(
    "dropping it on a desktop icon: it vibrates",
    flips >= 4,
    `${flips} direction changes`,
  );
  ok(
    "…then glides back to where it was before the drag",
    endB.x === start.x && endB.y === start.y,
    `${endB.x},${endB.y} (was ${start.x},${start.y})`,
  );
  ok(
    "…and the refused spot is not saved",
    controller._settings().bubblePos.x === start.x,
  );
  desktopVisible = false;
  await drag(310, 10);
  await sleep(700);
  const covered = b6.getBounds();
  ok(
    "over an icon that another window covers it is allowed to stay",
    covered.x === start.x + 310,
    `${covered.x}`,
  );
  await drag(-310, 300);
  await sleep(700);
  const free = b6.getBounds();
  ok(
    "on a free spot it simply stays",
    free.x === start.x && free.y === start.y + 310,
    `${free.x},${free.y}`,
  );
  controller._setProbe(null);
  // --- the bubble only shows on the Desktop and in File Explorer, not in other apps ---
  controller.hideBubble();
  await sleep(500);
  let fgNow = { hwnd: "10", cls: "CabinetWClass", exe: "explorer", pid: 111 };
  controller._setProbe({
    warm() {},
    stop() {},
    rects: async () => [],
    topIsDesktop: async () => false,
    foreground: async () => fgNow,
  });
  controller._set({ bubbleSize: "M", bubblePos: start, contextOnly: true });
  controller.showBubble();
  await until(() => live() && live().isVisible() && live());
  const vis = async (want, ms = 2500) =>
    !!(await until(
      () => (live() && live().isVisible() ? true : false) === want,
      ms,
    ));
  ok("visible in a File Explorer window", await vis(true));
  fgNow = { hwnd: "20", cls: "Chrome_WidgetWin_1", exe: "chrome", pid: 222 };
  ok("goes away in a browser", await vis(false));
  fgNow = { hwnd: "30", cls: "Shell_TrayWnd", exe: "explorer", pid: 111 };
  await sleep(500);
  ok(
    "stays as it is while the taskbar has focus",
    !(live() && live().isVisible()),
  );
  fgNow = { hwnd: "40", cls: "Progman", exe: "explorer", pid: 111 };
  ok("comes back on the Desktop", await vis(true));
  fgNow = { hwnd: "20", cls: "Chrome_WidgetWin_1", exe: "chrome", pid: 222 };
  await vis(false);
  fgNow = { hwnd: "30", cls: "Shell_TrayWnd", exe: "explorer", pid: 111 };
  await sleep(300);
  controller.toggleBubble("tray");
  await until(() => live() && live().isVisible() && live());
  await sleep(900);
  ok(
    "summoned from the tray, it stays while that app is in front",
    !!(live() && live().isVisible()),
  );
  fgNow = { hwnd: "20", cls: "Chrome_WidgetWin_1", exe: "chrome", pid: 222 };
  await sleep(700);
  ok(
    "…even when the tray click handed focus back to that app",
    !!(live() && live().isVisible()),
  );
  fgNow = { hwnd: "50", cls: "UnrealWindow", exe: "game", pid: 333 };
  ok("…but goes away again when you switch to another app", await vis(false));
  controller._setContextOnly(false);
  ok("turning the option off shows it everywhere", await vis(true));
  controller._setContextOnly(true);
  controller._setProbe(null);
  controller.hideBubble();
  await sleep(300);
  controller._set({ bubbleSize: "M" });
  return { passed, failed, lines };
};
