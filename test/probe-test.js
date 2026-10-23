"use strict";
// Protocol test for src/radial/desktop-icons.js using a fake helper (no Windows needed):  node test/probe-test.js
const createProbe = require("../src/radial/desktop-icons");
const fakeHelper = `
const rl = require('readline').createInterface({ input: process.stdin });
console.log('ready');
rl.on('line', (l) => { const p = l.split(' ');
  if (p[1] === 'icons') console.log(p[0] + '|' + JSON.stringify([{ x: 100, y: 200, w: 80, h: 90 }, { x: 300, y: 200, w: 80, h: 90 }]));
  else if (p[1] === 'top') console.log(p[0] + '|' + (Number(p[2]) < 500 ? 'Progman' : 'CabinetWClass'));
  else if (p[1] === 'slow') setTimeout(() => console.log(p[0] + '|late'), 600);
});`;
(async () => {
  let pass = 0,
    fail = 0;
  const ok = (n, c, x = "") => {
    c ? pass++ : fail++;
    console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);
  };
  const screen = {
    screenToDipRect: (_w, r) => ({
      x: r.x / 2,
      y: r.y / 2,
      width: r.width / 2,
      height: r.height / 2,
    }),
    dipToScreenPoint: (p) => ({ x: p.x * 2, y: p.y * 2 }),
  };
  const probe = createProbe({
    screen,
    command: [process.execPath, ["-e", fakeHelper]],
  });
  const r = await probe.rects();
  ok(
    "icon rectangles come back converted to DIPs",
    r.length === 2 && r[0].x === 50 && r[0].width === 40 && r[1].x === 150,
    JSON.stringify(r[0]),
  );
  ok(
    "desktop is detected at a point over the desktop",
    (await probe.topIsDesktop({ x: 100, y: 100 })) === true,
  );
  ok(
    "another app window is detected at a point over a window",
    (await probe.topIsDesktop({ x: 400, y: 100 })) === false,
  );
  const [a, b] = await Promise.all([
    probe.topIsDesktop({ x: 10, y: 10 }),
    probe.topIsDesktop({ x: 900, y: 10 }),
  ]);
  ok(
    "concurrent questions get their own answers (ids)",
    a === true && b === false,
  );
  probe.stop();
  const bad = createProbe({
    screen,
    command: ["definitely-not-a-real-binary-xyz", []],
  });
  ok(
    "a helper that cannot start never blocks anything (fails open)",
    (await bad.rects()).length === 0 &&
      (await bad.topIsDesktop({ x: 1, y: 1 })) === false,
  );
  const cf = createProbe.classifyForeground;
  const F = (cls, exe, pid = 999, hwnd = "5") => ({ hwnd, cls, exe, pid });
  ok(
    "classify: Desktop and File Explorer windows show the bubble",
    cf(F("Progman", "explorer")) === "show" &&
      cf(F("WorkerW", "explorer")) === "show" &&
      cf(F("CabinetWClass", "explorer")) === "show",
  );
  ok(
    "classify: browsers, games and other apps hide it",
    [
      "chrome",
      "firefox",
      "msedge",
      "game",
      "Code",
      "ApplicationFrameHost",
    ].every((e) => cf(F("SomeWindow", e)) === "hide"),
  );
  ok(
    "classify: taskbar, tray flyout, Start, menus and our own windows keep the current state",
    cf(F("Shell_TrayWnd", "explorer")) === "neutral" &&
      cf(F("TopLevelWindowForOverflowXamlIsland", "explorer")) === "neutral" &&
      cf(F("#32768", "explorer")) === "neutral" &&
      cf(F("Windows.UI.Core.CoreWindow", "startmenuexperiencehost")) ===
        "neutral" &&
      cf(F("Chrome_WidgetWin_1", "Zest", 42), 42) === "neutral" &&
      cf(null) === "neutral",
  );
  const script = probe._psScript;
  ok(
    "PowerShell script embeds the C# helper and the here-string is well formed",
    /\$src = @'\n/.test(script) &&
      /\n'@\nAdd-Type/.test(script) &&
      script.includes("public static string TopAt") &&
      script.includes("public static string Foreground"),
  );
  console.log(`PROBE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
