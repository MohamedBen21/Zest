"use strict";
// Explorer integration: radial wheel window, background job toast, floating drop bubble, tray + global hotkey.
const {
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  Tray,
  globalShortcut,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const M = require("./menu");

module.exports = function createController(ctx) {
  const {
    app,
    enqueue,
    cancel,
    openMain,
    reader,
    settings,
    saveSettings,
    kindOf,
  } = ctx;
  const S = () => settings();
  const lang = () => S().lang || "en";
  const TEST = !!process.env.ZEST_RADIAL_TEST;
  let radial = null,
    toast = null,
    bubble = null,
    tray = null,
    genie = null,
    genieReady = null;
  let radialFiles = [],
    radialReady = null;
  const tracked = new Map(); // job id -> {id,label,status,progress,outputs,error}
  let toastHideT = null,
    collectT = null,
    collectBuf = [],
    collectAt = null;
  const iconPath = path.join(__dirname, "..", "..", "build", "icon.png");
  const wlog = ctx.log || require("./wheellog")(app);
  // Wheel window state machine (see showRadial/hideRadial): one session per right-click.
  //  - showing is idempotent: a visible wheel is never hidden and re-shown, it is only updated in place;
  //  - files from late Explorer launches (one process per selected file) are merged into the open wheel;
  //  - blur closes the wheel only after it really gained focus and a grace period has passed.
  const GRACE_MS = Number(process.env.ZEST_WHEEL_GRACE_MS || 300);
  const MERGE_MS = Number(process.env.ZEST_WHEEL_MERGE_MS || 2500);
  let session = 0,
    shownAt = 0,
    focusedAt = 0,
    armed = false,
    armT = null,
    unfocusedT = null,
    lastHide = { at: 0, key: "" };
  const keyOf = (files) => files.slice().sort().join("|");

  // ---------- helpers ----------
  const webPrefs = {
    preload: path.join(__dirname, "preload-radial.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false,
    backgroundThrottling: false,
  };
  function expand(paths) {
    const out = [];
    for (const p of paths) {
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          for (const c of fs.readdirSync(p).sort()) {
            const f = path.join(p, c);
            try {
              if (fs.statSync(f).isFile() && kindOf(f)) out.push(f);
            } catch (_) {}
          }
        } else if (kindOf(p)) out.push(p);
      } catch (_) {}
    }
    return [...new Set(out)];
  }
  const displayAt = (pt) => screen.getDisplayNearestPoint(pt).workArea;
  const displayBoundsAt = (pt) => screen.getDisplayNearestPoint(pt).bounds;

  // ---------- radial window ----------
  function ensureRadial() {
    if (radial && !radial.isDestroyed()) return radialReady;
    radial = new BrowserWindow({
      width: 720,
      height: 720,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      title: "Zest wheel",
      webPreferences: webPrefs,
    });
    radial.setAlwaysOnTop(true, "screen-saver");
    radial.setMenu(null);
    radial.on("focus", () => {
      focusedAt = Date.now();
      wlog("focus", { session, sinceShow: focusedAt - shownAt });
      clearTimeout(armT);
      armT = setTimeout(() => {
        if (radial && !radial.isDestroyed() && radial.isFocused()) {
          armed = true;
          wlog("blur-armed", { session });
        }
      }, GRACE_MS);
    });
    radial.on("blur", () => {
      const vis = radial.isVisible();
      if (!vis) return;
      if (TEST) {
        wlog("blur-ignored", { session, reason: "test" });
        return;
      }
      if (!armed) {
        // Focus moved away before the grace period ended (typically Explorer re-activating itself right after the
        // shell launch). Do NOT hide: that is what produced the show/hide flicker. Take focus back once instead.
        wlog("blur-ignored", {
          session,
          reason: focusedAt ? "grace" : "never-focused",
          sinceShow: Date.now() - shownAt,
        });
        if (Date.now() - shownAt < 1500)
          setTimeout(() => takeFocus("refocus"), 30);
        return;
      }
      hideRadial("blur");
    });
    radial.on("show", () => wlog("window-show", { session }));
    radial.on("hide", () => wlog("window-hide", { session }));
    radial.webContents.on("render-process-gone", (_e, d) =>
      wlog("renderer-gone", { reason: d && d.reason }),
    );
    radial.on("closed", () => {
      radial = null;
    });
    radialReady = radial.loadFile(path.join(__dirname, "radial.html"));
    return radialReady;
  }
  /** Explorer launches one process per selected file; collect them for a moment, then show one wheel. */
  function collect(paths, at) {
    wlog("launch", {
      files: paths.length,
      visible: !!(radial && !radial.isDestroyed() && radial.isVisible()),
    });
    // A wheel that just opened for this selection: merge late arrivals straight in (no new session, no re-show).
    if (
      radial &&
      !radial.isDestroyed() &&
      radial.isVisible() &&
      Date.now() - shownAt < MERGE_MS &&
      !collectBuf.length
    ) {
      api.showRadial(paths, null, null, { merge: true });
      return;
    }
    collectBuf.push(...paths);
    collectAt = at || collectAt;
    clearTimeout(collectT);
    collectT = setTimeout(
      () => {
        const p = collectBuf;
        collectBuf = [];
        const a = collectAt;
        collectAt = null;
        api.showRadial(p, a);
      },
      Number(process.env.ZEST_RADIAL_COLLECT_MS || 450),
    );
  }
  function takeFocus(why) {
    if (!radial || radial.isDestroyed() || !radial.isVisible()) return;
    try {
      if (process.platform === "win32" || process.platform === "darwin")
        app.focus({ steal: true });
    } catch (_) {}
    radial.focus();
    radial.moveTop();
    radial.webContents.focus();
    wlog("take-focus", { session, why, focused: radial.isFocused() });
  }
  async function showRadial(paths, at, preselect, opts = {}) {
    let files = expand(paths);
    if (!files.length && !opts.merge) {
      wlog("show-skipped", {
        reason: paths.length ? "unsupported" : "no-selection",
      });
      notify(paths.length ? "unsupported" : "noSelection");
      return false;
    }
    const visible = radial && !radial.isDestroyed() && radial.isVisible();
    if (visible && (opts.merge || keyOf(files) === keyOf(radialFiles))) {
      // Idempotent: already showing → update in place, never hide/show.
      const merged = [...new Set([...radialFiles, ...files])];
      const added = merged.length - radialFiles.length;
      wlog("show-update", { session, added, files: merged.length });
      if (added) {
        radialFiles = merged;
        const menu = M.menuFor(merged, {
          readerAvailable: !!reader.findReader(),
        });
        radial.webContents.send("radial:show", {
          items: menu.items,
          kinds: menu.kinds,
          count: merged.length,
          lang: lang(),
          preselect,
          legacyHover: process.env.ZEST_WHEEL_LEGACY_HOVER === "1",
          update: true,
        });
      }
      return true;
    }
    if (!files.length) return false;
    const key = keyOf(files);
    if (
      !visible &&
      lastHide.reason === "blur" &&
      lastHide.key === key &&
      Date.now() - lastHide.at < 700
    ) {
      wlog("show-suppressed", {
        reason: "same selection right after a blur-close",
      });
      return false;
    }
    session++;
    radialFiles = files;
    armed = false;
    focusedAt = 0;
    clearTimeout(armT);
    clearTimeout(unfocusedT);
    const menu = M.menuFor(files, { readerAvailable: !!reader.findReader() });
    await ensureRadial();
    const pt = at || screen.getCursorScreenPoint();
    const wa = displayAt(pt);
    // Keep the WHOLE wheel (all rings) inside the work area of the display it opens on; if the display is smaller than the wheel, centre it.
    const fit = (p, lo, size) => {
      const hi = lo + size - 720;
      return hi >= lo
        ? Math.round(Math.min(Math.max(p - 360, lo), hi))
        : Math.round(lo + (size - 720) / 2);
    };
    const x = fit(pt.x, wa.x, wa.width),
      y = fit(pt.y, wa.y, wa.height);
    radial.setBounds({ x, y, width: 720, height: 720 });
    radial.webContents.send("radial:show", {
      items: menu.items,
      kinds: menu.kinds,
      count: files.length,
      lang: lang(),
      preselect,
      legacyHover: process.env.ZEST_WHEEL_LEGACY_HOVER === "1",
    });
    shownAt = Date.now();
    wlog("show", {
      session,
      files: files.length,
      wasVisible: !!visible,
      x,
      y,
      cursor: pt,
    });
    if (!radial.isVisible()) radial.show();
    radial.setAlwaysOnTop(true, "screen-saver");
    takeFocus("show");
    // Focus-stealing prevention can refuse focus entirely; then a blur never comes. In that case close only when the
    // cursor has stayed well away from the wheel for a while (Esc / clicks need focus, which a click on the wheel gives).
    const watch = () => {
      if (!radial || radial.isDestroyed() || !radial.isVisible()) return;
      if (!radial.isFocused() && !TEST) {
        const c = screen.getCursorScreenPoint();
        const b = radial.getBounds();
        const dx = c.x - (b.x + 360),
          dy = c.y - (b.y + 360);
        if (Math.hypot(dx, dy) > 420) {
          watch.away = (watch.away || 0) + 250;
          if (watch.away >= 6000) {
            hideRadial("unfocused-cursor-away");
            return;
          }
        } else watch.away = 0;
      } else watch.away = 0;
      unfocusedT = setTimeout(watch, 250);
    };
    unfocusedT = setTimeout(watch, 250);
    return true;
  }
  function hideRadial(reason = "close") {
    clearTimeout(armT);
    clearTimeout(unfocusedT);
    armed = false;
    if (radial && !radial.isDestroyed() && radial.isVisible()) {
      lastHide = { at: Date.now(), key: keyOf(radialFiles), reason };
      wlog("hide", { session, reason, shownFor: Date.now() - shownAt });
      radial.hide();
    }
    restoreBubbleHome();
    setTimeout(maybeQuit, 300);
  }
  ipcMain.on("radial:close", (_e, d) =>
    hideRadial(d && d.picked ? "picked" : (d && d.reason) || "renderer-close"),
  );
  ipcMain.on("radial:log", (_e, d) => wlog("renderer", d || {}));
  ipcMain.on("radial:pick", (_e, d) => runPick(d.action, radialFiles, d.label));

  function runPick(action, files, label) {
    const jobs = M.resolveJobs(action, files);
    const special = jobs.find((j) => j.special);
    if (special) {
      if (special.special === "reader") {
        for (const f of special.files) {
          const r = reader.openInReader(f, { edit: special.edit });
          wlog("reader", { file: f, ...r });
        }
      }
      if (special.special === "studio")
        openMain({ paths: special.files, tab: special.tab });
      return [];
    }
    const ids = enqueue(jobs.map(({ label: l, ...j }) => j));
    ids.forEach((id, i) =>
      tracked.set(id, {
        id,
        label: jobs[i].label || label,
        status: "queued",
        progress: 0,
      }),
    );
    showToast();
    return ids;
  }

  // ---------- toast ----------
  function ensureToast() {
    if (toast && !toast.isDestroyed()) return Promise.resolve();
    toast = new BrowserWindow({
      width: 400,
      height: 160,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      focusable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: webPrefs,
    });
    toast.setAlwaysOnTop(true, "pop-up-menu");
    toast.on("closed", () => {
      toast = null;
    });
    return toast.loadFile(path.join(__dirname, "toast.html"));
  }
  async function showToast() {
    await ensureToast();
    pushToast();
    if (!toast.isVisible()) {
      toast.showInactive();
      if (!toast.isVisible()) toast.show();
    }
  }
  function pushToast() {
    if (!toast || toast.isDestroyed()) return;
    const jobs = [...tracked.values()].slice(-8);
    const h = Math.min(
      480,
      74 + jobs.reduce((a, j) => a + (j.status === "error" ? 76 : 60), 0),
    );
    const wa = displayAt(screen.getCursorScreenPoint());
    toast.setBounds({
      x: wa.x + wa.width - 410,
      y: wa.y + wa.height - h - 8,
      width: 400,
      height: h,
    });
    toast.webContents.send("toast:update", { jobs, lang: lang() });
    const active = jobs.some(
      (j) => j.status === "queued" || j.status === "running",
    );
    clearTimeout(toastHideT);
    if (!active && jobs.length)
      toastHideT = setTimeout(
        hideToast,
        Number(process.env.ZEST_TOAST_MS || 9000),
      );
  }
  function hideToast() {
    if (toast && !toast.isDestroyed()) toast.hide();
    for (const [id, j] of tracked)
      if (!["queued", "running"].includes(j.status)) tracked.delete(id);
    setTimeout(maybeQuit, 200);
  }
  function notify(key) {
    tracked.set("n" + Date.now(), {
      id: "n",
      label: require("./strings-node")(lang(), key),
      status: "cancelled",
      progress: 0,
    });
    showToast();
  }
  function ensureGenie() {
    if (genie && !genie.isDestroyed()) return genieReady;
    genie = new BrowserWindow({
      width: 1024,
      height: 768,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      focusable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      title: "Zest Genie",
      webPreferences: webPrefs,
    });
    genie.setAlwaysOnTop(true, "screen-saver");
    genie.setIgnoreMouseEvents(true);
    genie.on("closed", () => {
      genie = null;
      genieReady = null;
    });
    genieReady = genie.loadFile(path.join(__dirname, "genie.html")).then(() => genie);
    return genieReady;
  }

  function getGenieFileIcon(ext) {
    const e = (ext || "").toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg", "ico"].includes(e)) return "🖼️";
    if (["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "3gp"].includes(e)) return "🎬";
    if (["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma"].includes(e)) return "🎵";
    if (e === "pdf") return "📕";
    if (e === "html") return "🌐";
    return "📄";
  }

  async function getFileThumbnailInfo(filePath) {
    const fileName = path.basename(filePath);
    const ext = fileName.split(".").pop().toLowerCase();
    let thumbnail = null;
    let textSnippet = null;
    let sizeStr = "";

    try {
      const bytes = fs.statSync(filePath).size;
      sizeStr = bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";
    } catch (_) {}

    // 1. If it's an image, read directly as base64 data URL
    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "svg", "avif"].includes(ext)) {
      try {
        const buf = fs.readFileSync(filePath);
        if (buf.length < 20 * 1024 * 1024) {
          const mime = ext === "svg" ? "image/svg+xml" : ("image/" + (ext === "jpg" ? "jpeg" : ext));
          thumbnail = `data:${mime};base64,${buf.toString("base64")}`;
        }
      } catch (_) {}
    }

    // 2. If it's a text/document/code file, read a snippet of lines
    if (["txt", "md", "json", "csv", "js", "html", "css", "py", "xml", "log", "ts"].includes(ext)) {
      try {
        textSnippet = fs.readFileSync(filePath, "utf8").slice(0, 500);
      } catch (_) {}
    }

    // 3. If no image thumbnail yet, ask Electron for the Windows high-res shell icon
    if (!thumbnail && app.getFileIcon) {
      try {
        const nativeIcon = await app.getFileIcon(filePath, { size: "large" });
        if (nativeIcon && !nativeIcon.isEmpty()) {
          thumbnail = nativeIcon.toDataURL();
        }
      } catch (_) {}
    }

    return {
      name: fileName,
      ext,
      icon: getGenieFileIcon(ext),
      thumbnail,
      textSnippet,
      sizeStr,
    };
  }

  async function playGenieDrop(paths, b) {
    if (!paths || !paths.length || !alive()) return;
    try {
      const bCenter = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const bounds = displayBoundsAt(bCenter);
      await ensureGenie();
      genie.setBounds(bounds);
      genie.showInactive();
      genie.moveTop();

      const cardW = 320;
      const cardH = 200;
      let cardX = Math.round(b.x + (b.width - cardW) / 2);
      // Ensure vertical clearance so the macOS lamp neck has plenty of room to stretch
      let cardY = Math.round(b.y - cardH - 60);
      if (cardY < bounds.y + 20) {
        cardY = Math.round(b.y + b.height + 60);
      }
      cardX = Math.max(bounds.x + 20, Math.min(bounds.x + bounds.width - cardW - 20, cardX));

      const wGeom = {
        x: cardX - bounds.x,
        y: cardY - bounds.y,
        width: cardW,
        height: cardH,
      };

      const iGeom = {
        x: Math.round(b.x + b.width / 2 - 18) - bounds.x,
        y: Math.round(b.y + b.height / 2 - 18) - bounds.y,
        width: 36,
        height: 36,
      };

      const fileInfo = await getFileThumbnailInfo(paths[0]);
      fileInfo.count = paths.length;
      if (paths.length > 1) {
        fileInfo.subtitle = `+${paths.length - 1} more files · ${fileInfo.sizeStr}`;
      } else {
        fileInfo.subtitle = fileInfo.sizeStr ? `${fileInfo.sizeStr} · Ready` : "";
      }

      genie.webContents.send("genie:play", {
        isRising: false,
        duration: 540,
        canvasWidth: bounds.width,
        canvasHeight: bounds.height,
        wGeom,
        iGeom,
        info: fileInfo,
      });

      await new Promise((r) => {
        const t = setTimeout(r, 680);
        ipcMain.once("genie:done", () => {
          clearTimeout(t);
          r();
        });
      });

      if (genie && !genie.isDestroyed()) genie.hide();
      if (alive()) bubble.webContents.send("bubble:swallow");
    } catch (err) {
      console.error("[Zest Genie] drop error:", err);
    }
  }

  async function playGenieOpen(filePath, action = "open") {
    if (!filePath) return;
    try {
      const cursorPt = screen.getCursorScreenPoint();
      let from;
      if (toast && !toast.isDestroyed() && toast.isVisible()) {
        from = toast.getBounds();
      } else if (bubble && !bubble.isDestroyed() && bubble.isVisible()) {
        from = bubble.getBounds();
      } else {
        from = { x: cursorPt.x - 20, y: cursorPt.y - 20, width: 40, height: 40 };
      }

      const bounds = displayBoundsAt({ x: from.x + from.width / 2, y: from.y + from.height / 2 });
      await ensureGenie();
      genie.setBounds(bounds);
      genie.showInactive();
      genie.moveTop();

      const cardW = 340;
      const cardH = 220;
      const targetX = Math.round(bounds.x + (bounds.width - cardW) / 2);
      const targetY = Math.round(bounds.y + (bounds.height - cardH) / 2);

      const wGeom = {
        x: targetX - bounds.x,
        y: targetY - bounds.y,
        width: cardW,
        height: cardH,
      };

      const iGeom = {
        x: Math.round(from.x + from.width / 2 - 20) - bounds.x,
        y: Math.round(from.y + from.height / 2 - 20) - bounds.y,
        width: 40,
        height: 40,
      };

      const fileInfo = await getFileThumbnailInfo(filePath);
      fileInfo.isOutput = true;
      fileInfo.subtitle =
        action === "show"
          ? "📁 Revealing in Explorer…"
          : fileInfo.sizeStr
            ? `${fileInfo.sizeStr} · Complete`
            : "✓ Complete";

      genie.webContents.send("genie:play", {
        isRising: true,
        duration: 540,
        canvasWidth: bounds.width,
        canvasHeight: bounds.height,
        wGeom,
        iGeom,
        info: fileInfo,
      });

      await new Promise((r) => {
        const t = setTimeout(r, 680);
        ipcMain.once("genie:done", () => {
          clearTimeout(t);
          r();
        });
      });

      await new Promise((r) => setTimeout(r, 220));
      if (genie && !genie.isDestroyed()) genie.hide();
    } catch (err) {
      console.error("[Zest Genie] open error:", err);
    }

    if (action === "show") {
      shell.showItemInFolder(filePath);
    } else {
      shell.openPath(filePath);
    }
  }

  ipcMain.on("toast:close", hideToast);
  ipcMain.on("toast:show", (_e, p) => playGenieOpen(p, "show"));
  ipcMain.on("toast:open", (_e, p) => playGenieOpen(p, "open"));
  ipcMain.on("toast:cancel", (_e, id) => cancel(id));
  function onJobUpdate(d) {
    const j = tracked.get(d.id);
    if (!j) return;
    Object.assign(j, d);
    pushToast();
  }

  // ---------- bubble ----------
  // Three fixed sizes (S/M/L, remembered) plus a tiny "minimized" size. The window ALWAYS keeps exactly that size:
  // min = max = size, and every move/resize goes through setBounds() with an explicit width AND height (setPosition() on
  // scaled displays can make a transparent window grow while it is dragged).
  const BUB_SIZES = { S: 56, M: 76, L: 104 };
  let bubOrigin = null,
    bubAnim = null,
    bubHome = null,
    bubDragStart = null,
    iconsReq = null;
  let fgTimer = null,
    fgBusy = false,
    autoHidden = false,
    lastAppFg = null,
    forceFg = null,
    bubDragging = false;
  // Where the desktop's icons are (Windows only; null elsewhere = nothing is ever refused).
  let probe =
    ctx.iconProbe !== undefined
      ? ctx.iconProbe
      : process.platform === "win32" && process.env.ZEST_NO_PROBE !== "1"
        ? require("./desktop-icons")({ screen, log: wlog })
        : null;
  const bubKey = () => (BUB_SIZES[S().bubbleSize] ? S().bubbleSize : "M");
  const bubSize = () => BUB_SIZES[bubKey()];
  const alive = () => bubble && !bubble.isDestroyed();
  const workAreaFor = (pt) =>
    screen.getDisplayNearestPoint({ x: Math.round(pt.x), y: Math.round(pt.y) })
      .workArea;
  function clampPos(x, y, sz) {
    const wa = workAreaFor({ x: x + sz / 2, y: y + sz / 2 });
    return {
      x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - sz)),
      y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - sz)),
    };
  }
  function placeBubble(x, y) {
    if (!alive()) return;
    const sz = bubSize();
    bubble.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: sz,
      height: sz,
    });
  }
  function lockBubble(sz) {
    bubble.setMinimumSize(sz, sz);
    bubble.setMaximumSize(sz, sz);
  }
  function pushBubbleState() {
    if (alive()) {
      bubble.webContents.send("bubble:mini", false);
      bubble.webContents.send("bubble:size", bubKey());
    }
  }
  function resizeBubble() {
    // new size, same centre, kept on screen
    if (!alive()) return;
    const b = bubble.getBounds(),
      sz = bubSize();
    const p = clampPos(b.x + (b.width - sz) / 2, b.y + (b.height - sz) / 2, sz);
    bubble.setResizable(true);
    lockBubble(sz);
    bubble.setBounds({ x: p.x, y: p.y, width: sz, height: sz });
    bubble.setResizable(false);
    saveSettings({ bubblePos: p });
    pushBubbleState();
  }
  function tween(from, to, ms, done) {
    if (bubAnim) clearInterval(bubAnim);
    const t0 = Date.now(),
      ease = (t) => 1 - Math.pow(1 - t, 3);
    bubAnim = setInterval(() => {
      if (!alive()) {
        clearInterval(bubAnim);
        bubAnim = null;
        return;
      }
      const t = Math.min(1, (Date.now() - t0) / ms),
        k = ease(t);
      placeBubble(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      try {
        bubble.setOpacity(from.o + (to.o - from.o) * k);
      } catch (_) {}
      if (t >= 1) {
        clearInterval(bubAnim);
        bubAnim = null;
        if (done) done();
      }
    }, 16);
  }
  const trayCorner = (sz, wa) => ({
    x: wa.x + wa.width - sz - 16,
    y: wa.y + wa.height,
  }); // just below the work area = "inside the taskbar"
  /** opts.fly: slide up out of the tray corner to the saved spot. opts.at: pop up centred on that point (hotkey). */
  function showBubble(opts = {}) {
    if (alive()) {
      bubble.showInactive();
      return;
    }
    if (probe) {
      probe.warm();
      startContextWatch();
    }
    const sz = bubSize(),
      wa0 = screen.getPrimaryDisplay().workArea;
    const saved = S().bubblePos || {
      x: wa0.x + wa0.width - 120,
      y: wa0.y + wa0.height - 160,
    };
    const pos = opts.at
      ? clampPos(opts.at.x - sz / 2, opts.at.y - sz / 2, sz)
      : clampPos(saved.x, saved.y, sz);
    bubble = new BrowserWindow({
      x: pos.x,
      y: pos.y,
      width: sz,
      height: sz,
      minWidth: sz,
      minHeight: sz,
      maxWidth: sz,
      maxHeight: sz,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      focusable: true,
      backgroundColor: "#00000000",
      title: "Zest bubble",
      webPreferences: webPrefs,
    });
    const me = bubble;
    me.on("closed", () => {
      if (bubble === me) bubble = null;
    }); // a late 'closed' from an old window must not clear a newly shown bubble
    bubble.setAlwaysOnTop(true, "floating");
    bubble.loadFile(path.join(__dirname, "bubble.html"));
    ensureGenie().catch(() => {});
    bubble.webContents.once("did-finish-load", () => {
      if (!alive() || bubble !== me) return;
      bubble.webContents.send("bubble:lang", lang());
      pushBubbleState();
      if (opts.fly) {
        const wa = workAreaFor(pos),
          c = trayCorner(sz, wa);
        placeBubble(c.x, c.y);
        try {
          bubble.setOpacity(0);
        } catch (_) {}
        bubble.showInactive();
        bubble.webContents.send("bubble:pop");
        tween({ x: c.x, y: c.y, o: 0 }, { x: pos.x, y: pos.y, o: 1 }, 340);
      } else if (opts.at) {
        try {
          bubble.setOpacity(0);
        } catch (_) {}
        bubble.showInactive();
        bubble.webContents.send("bubble:pop");
        tween({ x: pos.x, y: pos.y, o: 0 }, { x: pos.x, y: pos.y, o: 1 }, 180);
      } else bubble.showInactive();
    });
    saveSettings({ bubble: true });
    refreshTray();
  }
  function hideBubble() {
    stopContextWatch();
    if (bubAnim) {
      clearInterval(bubAnim);
      bubAnim = null;
    }
    if (alive()) bubble.close();
    bubble = null;
    if (probe) probe.stop();
    saveSettings({ bubble: false });
    refreshTray();
    setTimeout(maybeQuit, 200);
  }
  /** Slide back into the tray corner, then close. */
  function dismissBubble() {
    if (!alive()) return hideBubble();
    const b = bubble.getBounds(),
      c = trayCorner(b.width, workAreaFor(b));
    tween({ x: b.x, y: b.y, o: 1 }, { x: c.x, y: c.y, o: 0 }, 240, () =>
      hideBubble(),
    );
  }
  /** mode 'tray': tray-icon click; mode 'cursor': hotkey, appears under the mouse. */
  function toggleBubble(mode) {
    if (alive() && bubble.isVisible()) return dismissBubble();
    if (alive()) {
      bubble.close();
      bubble = null;
    }
    forceFg = lastAppFg;
    autoHidden = false; // you asked for it explicitly: it stays until you switch to another window
    showBubble(
      mode === "cursor" ? { at: screen.getCursorScreenPoint() } : { fly: true },
    );
  }
  // ---------- show the bubble only where it is useful: the Desktop and File Explorer (not in games, browsers, other apps) ----------
  const FG_MS = Number(process.env.ZEST_FG_MS || 450);
  function fade(to, ms, done) {
    if (!alive()) return;
    const from = (() => {
      try {
        return bubble.getOpacity();
      } catch (_) {
        return to ? 0 : 1;
      }
    })();
    const t0 = Date.now();
    if (bubAnim) {
      clearInterval(bubAnim);
      bubAnim = null;
    }
    bubAnim = setInterval(() => {
      if (!alive()) {
        clearInterval(bubAnim);
        bubAnim = null;
        return;
      }
      const t = Math.min(1, (Date.now() - t0) / ms);
      try {
        bubble.setOpacity(from + (to - from) * t);
      } catch (_) {}
      if (t >= 1) {
        clearInterval(bubAnim);
        bubAnim = null;
        if (done) done();
      }
    }, 16);
  }
  function autoHide() {
    if (!alive() || autoHidden) return;
    autoHidden = true;
    fade(0, 150, () => {
      if (alive() && autoHidden) bubble.hide();
    });
  }
  function autoShow() {
    if (!alive() || !autoHidden) return;
    autoHidden = false;
    try {
      bubble.setOpacity(0);
    } catch (_) {}
    bubble.showInactive();
    fade(1, 180);
  }
  async function tickContext() {
    if (fgBusy || !probe || !alive()) return;
    fgBusy = true;
    try {
      const fg = await probe.foreground();
      const kind = require("./desktop-icons").classifyForeground(
        fg,
        process.pid,
      );
      if (kind === "neutral") return;
      lastAppFg = fg.hwnd;
      if (kind === "show") forceFg = null;
      const wantHidden =
        S().contextOnly !== false && kind === "hide" && fg.hwnd !== forceFg;
      if (
        bubDragging ||
        (radial && !radial.isDestroyed() && radial.isVisible())
      )
        return;
      if (wantHidden) autoHide();
      else autoShow();
    } catch (_) {
    } finally {
      fgBusy = false;
    }
  }
  function startContextWatch() {
    if (fgTimer || !probe) return;
    fgTimer = setInterval(tickContext, FG_MS);
  }
  function stopContextWatch() {
    if (fgTimer) clearInterval(fgTimer);
    fgTimer = null;
    autoHidden = false;
  }
  function setContextOnly(on) {
    saveSettings({ contextOnly: !!on });
    if (!on) autoShow();
    else tickContext();
    refreshTray();
  }
  function setBubbleSize(k) {
    if (!BUB_SIZES[k]) return;
    saveSettings({ bubbleSize: k });
    resizeBubble();
    refreshTray();
  }
  // Dragging: the renderer sends the TOTAL offset since pointer-down; we add it to the window's start position.
  // Offsets can be fractional on scaled displays (125 %/150 %), so they are rounded.
  ipcMain.on("bubble:dragstart", () => {
    if (bubAnim) {
      clearInterval(bubAnim);
      bubAnim = null;
    }
    bubOrigin = alive() ? bubble.getPosition() : null;
    bubHome = null; /* the user is moving it: that is the new home */
    bubDragging = true;
    bubDragStart = bubOrigin ? { x: bubOrigin[0], y: bubOrigin[1] } : null;
    iconsReq = probe
      ? probe.rects()
      : null; /* ask early, the answer is ready by the time it is dropped */
  });
  ipcMain.on("bubble:move", (_e, d) => {
    if (!alive() || !bubOrigin || !d) return;
    const dx = Math.round(Number(d.dx)),
      dy = Math.round(Number(d.dy));
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    placeBubble(bubOrigin[0] + dx, bubOrigin[1] + dy);
  });
  const overlaps = (a, r, tol = 4) =>
    a.x + tol < r.x + r.width &&
    r.x + tol < a.x + a.width &&
    a.y + tol < r.y + r.height &&
    r.y + tol < a.y + a.height;
  /** Is the bubble (DIP rect) sitting on a desktop icon that is actually visible (not covered by another window)? */
  async function onDesktopIcon(rect, req) {
    if (!probe) return false;
    const icons = await Promise.race([
      req || probe.rects(),
      new Promise((r) => setTimeout(() => r([]), 1500)),
    ]);
    for (const r of icons || []) {
      if (!overlaps(rect, r)) continue;
      const cx = Math.round(
          (Math.max(rect.x, r.x) +
            Math.min(rect.x + rect.width, r.x + r.width)) /
            2,
        ),
        cy = Math.round(
          (Math.max(rect.y, r.y) +
            Math.min(rect.y + rect.height, r.y + r.height)) /
            2,
        );
      if (await probe.topIsDesktop({ x: cx, y: cy })) return true;
    }
    return false;
  }
  /** Refused spot: vibrate on the spot, then glide smoothly back to where the bubble was before this drag. */
  function rejectToHome(home) {
    if (!alive()) return;
    if (bubAnim) {
      clearInterval(bubAnim);
      bubAnim = null;
    }
    const from = bubble.getBounds();
    const t0 = Date.now(),
      DUR = 440;
    try {
      bubble.webContents.send("bubble:deny");
    } catch (_) {}
    bubAnim = setInterval(() => {
      if (!alive()) {
        clearInterval(bubAnim);
        bubAnim = null;
        return;
      }
      const t = (Date.now() - t0) / DUR;
      if (t >= 1) {
        clearInterval(bubAnim);
        bubAnim = null;
        tween(
          { x: from.x, y: from.y, o: 1 },
          { x: home.x, y: home.y, o: 1 },
          420,
          () => {
            saveSettings({ bubblePos: home });
          },
        );
        return;
      }
      placeBubble(
        from.x + Math.sin(t * Math.PI * 2 * 7) * 10 * (1 - t),
        from.y,
      );
    }, 16);
  }
  ipcMain.on("bubble:moved", async () => {
    if (!alive()) return;
    const b = bubble.getBounds(),
      sz = bubSize(),
      p = clampPos(b.x, b.y, sz);
    placeBubble(p.x, p.y);
    bubDragging = false;
    const start = bubDragStart,
      req = iconsReq;
    bubOrigin = null;
    bubDragStart = null;
    iconsReq = null;
    let blocked = false;
    try {
      blocked =
        !!start &&
        (await onDesktopIcon({ x: p.x, y: p.y, width: sz, height: sz }, req));
    } catch (_) {}
    if (!alive()) return;
    if (blocked) rejectToHome(start);
    else saveSettings({ bubblePos: p });
  });
  ipcMain.on("bubble:click", () => openMain({}));
  ipcMain.on("bubble:minimize", () => dismissBubble()); // the "–" button: slides back into the tray corner; bring it back with a tray click or Ctrl+Alt+B
  ipcMain.on("bubble:size", (_e, k) => setBubbleSize(k));
  // Files dropped on the bubble: the wheel opens fully inside the screen. If that means it had to shift away from the bubble, the bubble
  // rides to the wheel's hub while the wheel is open and goes back to where the user put it (its "home") when the wheel closes.
  ipcMain.on("bubble:drop", async (_e, arg) => {
    if (!alive()) return;
    const paths = Array.isArray(arg) ? arg : (arg && arg.paths) || [];
    if (!paths.length) return;
    const b = bubble.getBounds(),
      h = Math.round(b.width / 2);
    const home = bubHome || { x: b.x, y: b.y };

    await playGenieDrop(paths, b);

    const shown = await api.showRadial(paths, { x: b.x + h, y: b.y + h });
    if (!shown || !alive() || !radial || radial.isDestroyed()) return;
    bubHome = home;
    const rb = radial.getBounds(),
      sz = bubSize(),
      cur = bubble.getBounds();
    tween(
      { x: cur.x, y: cur.y, o: 1 },
      { x: rb.x + 360 - sz / 2, y: rb.y + 360 - sz / 2, o: 1 },
      180,
    );
  });
  function restoreBubbleHome() {
    const home = bubHome;
    bubHome = null;
    if (!home || !alive()) return;
    const cur = bubble.getBounds();
    tween({ x: cur.x, y: cur.y, o: 1 }, { x: home.x, y: home.y, o: 1 }, 240);
  }
  ipcMain.on("bubble:menu", () =>
    Menu.buildFromTemplate(trayMenu()).popup({ window: bubble }),
  );

  // ---------- tray, hotkey, start with Windows ----------
  function trayMenu() {
    const s = S();
    return [
      { label: "Open Zest", click: () => openMain({}) },
      {
        label: s.bubble ? "Hide floating bubble" : "Show floating bubble",
        click: () => (s.bubble ? hideBubble() : showBubble()),
      },
      {
        label: "Show the bubble only on the Desktop and in File Explorer",
        type: "checkbox",
        visible: !!s.bubble,
        checked: s.contextOnly !== false,
        click: (m) => setContextOnly(m.checked),
      },
      {
        label: "Bubble size",
        visible: !!s.bubble,
        submenu: [
          ["S", "Small"],
          ["M", "Medium"],
          ["L", "Large"],
        ].map(([k, n]) => ({
          label: n,
          type: "radio",
          checked: bubKey() === k,
          click: () => setBubbleSize(k),
        })),
      },
      { type: "separator" },
      {
        label: "Hotkey Ctrl+Alt+B summons the bubble at the cursor",
        type: "checkbox",
        checked: s.bubbleHotkey !== false,
        click: (m) => {
          saveSettings({ bubbleHotkey: m.checked });
          applyHotkey();
        },
      },
      {
        label: `Hotkey ${hotkeyLabel()} for selected Explorer files`,
        type: "checkbox",
        checked: s.hotkey !== false,
        click: (m) => {
          saveSettings({ hotkey: m.checked });
          applyHotkey();
        },
      },
      {
        label: "Start with Windows (background)",
        type: "checkbox",
        checked: !!s.startAtLogin,
        visible: process.platform === "win32",
        click: (m) => {
          saveSettings({ startAtLogin: m.checked });
          applyLogin();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          ctx.quitting = true;
          app.quit();
        },
      },
    ];
  }
  const hotkeyLabel = () =>
    (S().hotkeyAccel || "Control+Alt+M").replace("Control", "Ctrl");
  function refreshTray() {
    if (tray && !tray.isDestroyed())
      tray.setContextMenu(Menu.buildFromTemplate(trayMenu()));
  }
  function startHelper() {
    if (!tray && process.env.ZEST_NO_TRAY !== "1") {
      try {
        tray = new Tray(
          nativeImage
            .createFromPath(iconPath)
            .resize({ width: 16, height: 16 }),
        );
        tray.setToolTip(
          `Zest — click: show/hide the bubble · double-click: open · ${hotkeyLabel()}: wheel for selected files`,
        );
        tray.on("click", () => toggleBubble("tray"));
        tray.on("double-click", () => openMain({}));
        refreshTray();
      } catch (_) {
        tray = null;
      }
    }
    applyHotkey();
    if (S().bubble) showBubble();
  }
  function applyHotkey() {
    try {
      globalShortcut.unregisterAll();
    } catch (_) {}
    if (S().bubbleHotkey !== false) {
      try {
        globalShortcut.register("Control+Alt+B", () => toggleBubble("cursor"));
      } catch (_) {}
    }
    if (S().hotkey === false) return false;
    try {
      return globalShortcut.register(
        S().hotkeyAccel || "Control+Alt+M",
        onHotkey,
      );
    } catch (_) {
      return false;
    }
  }
  function applyLogin() {
    if (process.platform !== "win32" || !app.isPackaged) return;
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    app.setLoginItemSettings({
      openAtLogin: !!S().startAtLogin,
      path: exe,
      args: ["--background"],
      name: "Zest",
    });
  }
  async function onHotkey() {
    const at = screen.getCursorScreenPoint();
    const files = process.env.ZEST_HOTKEY_FILES
      ? process.env.ZEST_HOTKEY_FILES.split(path.delimiter)
      : await explorerSelection();
    return api.showRadial(files, at);
  }
  /** Selected items in the foreground File Explorer window (Windows; PowerShell + Shell.Application COM). */
  function explorerSelection() {
    if (process.platform !== "win32") return Promise.resolve([]);
    const ps = `$ErrorActionPreference='SilentlyContinue'
Add-Type -Namespace ZestW -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
$h=[int64][ZestW.U]::GetForegroundWindow()
$out=@()
foreach($w in (New-Object -ComObject Shell.Application).Windows()){ if([int64]$w.HWND -eq $h){ $s=@($w.Document.SelectedItems() | ForEach-Object { $_.Path }); if($s.Count -gt 0){ $out=$s; break } } }
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$out | ForEach-Object { [Console]::WriteLine($_) }`;
    return new Promise((resolve) => {
      const cp = require("child_process").spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          ps,
        ],
        { windowsHide: true },
      );
      let out = "";
      cp.stdout.on("data", (d) => (out += d));
      cp.on("error", () => resolve([]));
      cp.on("close", () =>
        resolve(
          out
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );
      setTimeout(() => {
        try {
          cp.kill();
        } catch (_) {}
      }, 8000);
    });
  }

  function anyVisible() {
    return [radial, toast, bubble].some(
      (w) => w && !w.isDestroyed() && w.isVisible(),
    );
  }
  function busy() {
    return [...tracked.values()].some(
      (j) => j.status === "queued" || j.status === "running",
    );
  }
  function maybeQuit() {
    if (
      ctx.helperActive() ||
      ctx.mainOpen() ||
      anyVisible() ||
      busy() ||
      collectBuf.length
    )
      return;
    app.quit();
  }

  const api = {
    collect,
    showRadial,
    hideRadial,
    runPick,
    onJobUpdate,
    showBubble,
    hideBubble,
    dismissBubble,
    toggleBubble,
    setBubbleSize,
    startHelper,
    applyHotkey,
    applyLogin,
    onHotkey,
    maybeQuit,
    explorerSelection,
    expand,
    _windows: () => ({ radial, toast, bubble, tray }),
    _log: wlog,
    _tracked: tracked,
    _files: () => radialFiles,
    _set: (x) => saveSettings(x),
    _settings: () => S(),
    _setProbe: (p) => {
      probe = p;
      if (p && alive()) startContextWatch();
    },
    _autoHidden: () => autoHidden,
    _setContextOnly: setContextOnly,
  };
  return api;
};
