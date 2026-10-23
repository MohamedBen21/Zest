"use strict";
// Detects Zest Reader (installed exe, ZEST_READER_PATH, or a registered zest-reader:// / reader:// protocol) and hands a file to it.
const fs = require("fs");
const path = require("path");
module.exports = ({ app, shell }) => {
  const READER_PROTOCOLS = ["zest-reader", "reader"];
  function findReader() {
    const env = process.env.ZEST_READER_PATH;
    if (env && fs.existsSync(env)) return { exe: env };
    if (process.platform === "win32") {
      const la = process.env.LOCALAPPDATA || "",
        pf = process.env.ProgramFiles || "C:\\Program Files",
        pf86 = process.env["ProgramFiles(x86)"] || "";
      const names = ["Zest Reader", "zest-reader", "ZestReader"];
      const cands = [];
      for (const n of names) {
        cands.push(
          path.join(la, "Programs", n, "Zest Reader.exe"),
          path.join(pf, n, "Zest Reader.exe"),
        );
        if (pf86) cands.push(path.join(pf86, n, "Zest Reader.exe"));
      }
      cands.push(
        path.join(
          path.dirname(process.execPath),
          "..",
          "Zest Reader",
          "Zest Reader.exe",
        ),
        path.join(path.dirname(process.execPath), "Zest Reader.exe"),
      );
      for (const c of cands) if (fs.existsSync(c)) return { exe: c };
    }
    for (const p of READER_PROTOCOLS) {
      try {
        const n = app.getApplicationNameForProtocol(`${p}://`);
        if (n && !/^zest( convert)?$/i.test(n)) return { protocol: p, name: n };
      } catch (_) {}
    }
    return null;
  }
  // opts.edit: open the PDF in Zest Reader's editor (Reader 1.1.0+: "--edit <file>" / zest-reader://edit?path=)
  function openInReader(file, opts = {}) {
    const r = findReader();
    if (!r) return { ok: false, error: "Zest Reader is not installed" };
    const edit = !!opts.edit;
    if (r.exe) {
      require("child_process")
        .spawn(r.exe, edit ? ["--edit", file] : [file], {
          detached: true,
          stdio: "ignore",
        })
        .unref();
      return { ok: true, via: "exe", edit };
    }
    shell.openExternal(
      `${r.protocol}://${edit ? "edit" : "open"}?path=${encodeURIComponent(file)}`,
    );
    return { ok: true, via: r.protocol, edit };
  }
  return { findReader, openInReader, READER_PROTOCOLS };
};
