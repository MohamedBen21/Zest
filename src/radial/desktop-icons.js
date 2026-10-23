"use strict";
// Desktop-icon probe (Windows only). Lets the floating bubble know where the desktop's file/shortcut/folder icons are,
// so it can refuse to be dropped on top of one (it shakes and glides back instead).
//
// A single long-lived PowerShell helper answers two questions over stdin/stdout (one line each, tagged with an id):
//   "<id> icons"            -> "<id>|[{x,y,w,h}, ...]"   bounds of every desktop icon, in physical screen pixels (UI Automation)
//   "<id> top <x> <y> <pid>" -> "<id>|<window class>"     class of the top-most visible window at that point, ignoring our own windows
//   "<id> fg"              -> "<id>|<hwnd>|<class>|<exe>|<pid>"  the foreground window (used to show the bubble only on the Desktop / in File Explorer)
// Everything here is best-effort: if the helper cannot start, nothing is ever blocked.
const { spawn } = require("child_process");

const CSHARP = String.raw`
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Automation;

public static class Probe {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string t);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);

  public static void Init() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
    catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
  }

  static IntPtr FindListView() {
    IntPtr prog = FindWindow("Progman", null);
    IntPtr defView = FindWindowEx(prog, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (defView == IntPtr.Zero) {
      IntPtr w = IntPtr.Zero;
      while (true) {
        w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
        if (w == IntPtr.Zero) break;
        defView = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (defView != IntPtr.Zero) break;
      }
    }
    if (defView == IntPtr.Zero) return IntPtr.Zero;
    return FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
  }

  public static string Icons() {
    StringBuilder sb = new StringBuilder("[");
    try {
      IntPtr lv = FindListView();
      if (lv == IntPtr.Zero || !IsWindowVisible(lv)) return "[]";
      AutomationElement root = AutomationElement.FromHandle(lv);
      AutomationElementCollection items = root.FindAll(TreeScope.Children, Condition.TrueCondition);
      bool first = true;
      foreach (AutomationElement it in items) {
        System.Windows.Rect r = it.Current.BoundingRectangle;
        if (r.IsEmpty || double.IsInfinity(r.X) || double.IsInfinity(r.Y)) continue;
        if (!first) sb.Append(",");
        first = false;
        sb.Append("{\"x\":").Append((int)r.X).Append(",\"y\":").Append((int)r.Y)
          .Append(",\"w\":").Append((int)r.Width).Append(",\"h\":").Append((int)r.Height).Append("}");
      }
    } catch (Exception) { }
    sb.Append("]");
    return sb.ToString();
  }

  public static string Foreground() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "0|||0";
    StringBuilder sb = new StringBuilder(64);
    GetClassName(h, sb, 64);
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    string exe = "";
    try { exe = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { }
    return h.ToInt64().ToString() + "|" + sb.ToString() + "|" + exe + "|" + pid.ToString();
  }

  static bool Cloaked(IntPtr h) {
    int v = 0;
    try { DwmGetWindowAttribute(h, 14, out v, 4); } catch (Exception) { }
    return v != 0;
  }

  public static string TopAt(int x, int y, int ownPid) {
    string found = "";
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || Cloaked(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if ((int)pid == ownPid) return true;
      if ((GetWindowLong(h, -20) & 0x20) != 0) return true;   // WS_EX_TRANSPARENT: click-through overlay, not really "there"
      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      if (x < r.L || x >= r.R || y < r.T || y >= r.B) return true;
      StringBuilder sb = new StringBuilder(64);
      GetClassName(h, sb, 64);
      found = sb.ToString();
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
`;

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$refs = @(
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.ControlType].Assembly.Location,
  [System.Windows.Rect].Assembly.Location
)
$src = @'
${CSHARP}
'@
Add-Type -TypeDefinition $src -ReferencedAssemblies $refs -Language CSharp
[Probe]::Init()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  $out = ''
  try {
    if ($p[1] -eq 'icons') { $out = [Probe]::Icons() }
    elseif ($p[1] -eq 'top') { $out = [Probe]::TopAt([int]$p[2], [int]$p[3], [int]$p[4]) }
    elseif ($p[1] -eq 'fg') { $out = [Probe]::Foreground() }
  } catch { $out = '' }
  [Console]::WriteLine($p[0] + '|' + $out)
}
`;

/**
 * @param {{ screen: import('electron').Screen, log?: Function, spawnImpl?: Function, command?: [string, string[]] }} o
 *   spawnImpl / command exist for tests (a fake helper speaking the same protocol).
 */
/**
 * Should the bubble be visible while this window is in front?
 *   'show'    the Desktop, or a File Explorer window (Downloads, Pictures, Videos, Documents, ...)
 *   'neutral' our own windows and Windows shell surfaces (taskbar, tray flyout, Start, menus): keep whatever state we are in
 *   'hide'    any other app: games, browsers, editors, ...
 */
function classifyForeground(fg, ownPid) {
  if (!fg || !fg.hwnd || fg.hwnd === "0") return "neutral";
  if (ownPid && fg.pid === ownPid) return "neutral";
  const cls = fg.cls || "",
    exe = (fg.exe || "").toLowerCase();
  if (/^(Progman|WorkerW)$/.test(cls)) return "show";
  if (/^(CabinetWClass|ExploreWClass)$/.test(cls)) return "show";
  if (exe === "explorer") return "neutral"; // taskbar, tray flyout, context menus, Alt+Tab, ... are all explorer.exe
  if (
    /^(searchhost|searchapp|startmenuexperiencehost|shellexperiencehost|textinputhost|lockapp)$/.test(
      exe,
    )
  )
    return "neutral";
  if (
    /^(Shell_TrayWnd|Shell_SecondaryTrayWnd|NotifyIconOverflowWindow|TopLevelWindowForOverflowXamlIsland|XamlExplorerHostIslandWindow|ForegroundStaging|MultitaskingViewFrame|#32768)$/.test(
      cls,
    )
  )
    return "neutral";
  return "hide";
}

module.exports = function createProbe({
  screen,
  log = () => {},
  spawnImpl = spawn,
  command,
} = {}) {
  let cp = null,
    buf = "",
    ready = false,
    dead = false,
    seq = 0,
    startT = null;
  const pending = new Map();
  const waitReady = [];

  function fail(why) {
    if (dead) return;
    dead = true;
    log("icon-probe-off", { why: String(why).slice(0, 300) });
    for (const [, p] of pending) p.resolve(null);
    pending.clear();
    waitReady.splice(0).forEach((f) => f());
    try {
      if (cp) cp.kill();
    } catch (_) {}
  }
  function start() {
    if (cp || dead) return;
    const cmd = command || [
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(PS_SCRIPT, "utf16le").toString("base64"),
      ],
    ];
    try {
      cp = spawnImpl(cmd[0], cmd[1], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      return fail((e && e.message) || e);
    }
    let err = "";
    const me = cp;
    cp.stdout.setEncoding("utf8");
    cp.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        onLine(line);
      }
    });
    cp.stderr.on("data", (d) => {
      err += d;
    });
    cp.on("error", (e) => fail((e && e.message) || e));
    cp.on("close", () => {
      if (cp === me) fail("helper exited " + err.slice(0, 200));
    });
    startT = setTimeout(() => {
      if (!ready) fail("helper did not start in time " + err.slice(0, 200));
    }, 15000);
  }
  function onLine(line) {
    if (!ready) {
      if (line.trim() === "ready") {
        ready = true;
        clearTimeout(startT);
        log("icon-probe-ready");
        waitReady.splice(0).forEach((f) => f());
      }
      return;
    }
    const k = line.indexOf("|");
    if (k < 0) return;
    const p = pending.get(line.slice(0, k));
    if (p) {
      pending.delete(line.slice(0, k));
      p.resolve(line.slice(k + 1));
    }
  }
  /** Send one command and resolve with the answer text (or null on timeout/failure). */
  function ask(text, ms = 2500) {
    return new Promise((resolve) => {
      if (dead) return resolve(null);
      start();
      if (dead) return resolve(null);
      const id = String(++seq);
      const t = setTimeout(() => {
        if (pending.delete(id)) resolve(null);
      }, ms);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
      });
      const send = () => {
        try {
          cp.stdin.write(id + " " + text + "\n");
        } catch (_) {
          pending.delete(id);
          clearTimeout(t);
          resolve(null);
        }
      };
      if (ready) send();
      else
        waitReady.push(() => {
          if (dead) return;
          send();
        });
    });
  }
  const toDip = (r) => {
    try {
      return screen.screenToDipRect(null, r);
    } catch (_) {
      return r;
    }
  };

  return {
    /** Start the helper early so the first answer is fast. */
    warm() {
      start();
    },
    /** Desktop icon bounds in DIPs (what BrowserWindow uses): [{x,y,width,height}] */
    async rects() {
      const txt = await ask("icons");
      if (!txt) return [];
      try {
        return JSON.parse(txt).map((r) =>
          toDip({ x: r.x, y: r.y, width: r.w, height: r.h }),
        );
      } catch (_) {
        return [];
      }
    },
    /** Is the desktop itself (not another app's window) what you see at this DIP point? */
    async topIsDesktop(pt) {
      let p = pt;
      try {
        p = screen.dipToScreenPoint({
          x: Math.round(pt.x),
          y: Math.round(pt.y),
        });
      } catch (_) {}
      const cls = await ask(
        `top ${Math.round(p.x)} ${Math.round(p.y)} ${process.pid}`,
      );
      return cls != null && /^(Progman|WorkerW)$/.test(cls.trim());
    },
    /** Stop the helper (frees its memory); it starts again on the next question or warm(). */
    /** The foreground window: { hwnd, cls, exe, pid } or null. */
    async foreground() {
      const txt = await ask("fg");
      if (!txt) return null;
      const p = txt.split("|");
      return p.length >= 4
        ? { hwnd: p[0], cls: p[1], exe: p[2], pid: Number(p[3]) }
        : null;
    },
    stop() {
      const p = cp;
      cp = null;
      ready = false;
      buf = "";
      clearTimeout(startT);
      for (const [, q] of pending) q.resolve(null);
      pending.clear();
      waitReady.splice(0);
      try {
        if (p) p.kill();
      } catch (_) {}
    },
    _psScript: PS_SCRIPT,
  };
};
module.exports.classifyForeground = classifyForeground;
