"use strict";
const b = document.getElementById("b"),
  minBtn = document.getElementById("min");
let drag = null,
  moved = false;
rapi.on("bubble:mini", (on) => {
  document.body.classList.toggle("mini", !!on);
});
rapi.on("bubble:deny", () => {
  b.classList.add("deny");
  if (typeof ZestAudio !== "undefined") ZestAudio.deny();
  setTimeout(() => b.classList.remove("deny"), 700);
});
rapi.on("bubble:size", (k) => {
  document
    .querySelectorAll("#sz button")
    .forEach((x) => x.classList.toggle("on", x.dataset.k === k));
});
rapi.on("bubble:pop", () => {
  b.classList.remove("pop");
  void b.offsetWidth;
  b.classList.add("pop");
  if (typeof ZestAudio !== "undefined") ZestAudio.summon();
  setTimeout(() => b.classList.remove("pop"), 450);
});
document.querySelectorAll("#sz button").forEach((x) => {
  x.addEventListener("pointerdown", (e) => e.stopPropagation());
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof ZestAudio !== "undefined") ZestAudio.click();
    rapi.send("bubble:size", x.dataset.k);
  });
});
rapi.on("bubble:lang", (l) => {
  b.title = rt(l, "bubbleTip");
});
minBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
minBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (typeof ZestAudio !== "undefined") ZestAudio.dismiss();
  rapi.send("bubble:minimize");
});
b.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  drag = { x: e.screenX, y: e.screenY };
  moved = false;
  rapi.send("bubble:dragstart");
  b.setPointerCapture(e.pointerId);
});
b.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.x,
    dy = e.screenY - drag.y;
  if (!moved && Math.hypot(dx, dy) < 4) return;
  moved = true;
  rapi.send("bubble:move", { dx: Math.round(dx), dy: Math.round(dy) });
});
b.addEventListener("pointerup", () => {
  if (drag && !moved) {
    if (typeof ZestAudio !== "undefined") ZestAudio.click();
    rapi.send("bubble:click");
  }
  if (moved) {
    if (typeof ZestAudio !== "undefined") ZestAudio.snap();
    rapi.send("bubble:moved");
  }
  drag = null;
});
b.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  rapi.send("bubble:menu");
});
const vortexStage = document.getElementById("vortexStage");
const shockwave = document.getElementById("shockwave");

function getFileIcon(ext) {
  const e = (ext || "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg", "ico"].includes(e)) return "🖼️";
  if (["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "3gp"].includes(e)) return "🎬";
  if (["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma"].includes(e)) return "🎵";
  if (e === "pdf") return "📕";
  return "📄";
}

function playBlackHoleSuck(clientX, clientY, paths, onDone) {
  if (!vortexStage) {
    if (typeof ZestAudio !== "undefined") ZestAudio.drop();
    if (onDone) onDone();
    return;
  }

  vortexStage.replaceChildren();
  const rect = b.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  const count = paths.length;
  const maxCards = Math.min(count, 3);

  // Play audio drop sound (swoosh-in.wav)
  if (typeof ZestAudio !== "undefined") ZestAudio.drop();

  // Trigger swallow implosion on bubble core
  b.classList.remove("swallowing");
  void b.offsetWidth;
  b.classList.add("swallowing");

  if (shockwave) {
    shockwave.classList.remove("burst");
    void shockwave.offsetWidth;
    setTimeout(() => shockwave.classList.add("burst"), 120);
  }

  const cardW = 34;
  const cardH = 42;

  for (let i = 0; i < maxCards; i++) {
    const card = document.createElement("div");
    card.className = "suck-card";

    const offsetAngle = (i - (maxCards - 1) / 2) * 0.35;
    const startX = (clientX || (rect.left + cx)) - rect.left + Math.sin(offsetAngle) * 12;
    const startY = (clientY || (rect.top + cy)) - rect.top + Math.cos(offsetAngle) * 8;

    const dx = cx - startX;
    const dy = cy - startY;
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;

    const midX = startX + dx * 0.45;
    const midY = startY + dy * 0.45;
    const nearX = startX + dx * 0.82;
    const nearY = startY + dy * 0.82;
    const singX = cx - cardW / 2;
    const singY = cy - cardH / 2;

    card.style.setProperty("--start-x", `${startX - cardW / 2}px`);
    card.style.setProperty("--start-y", `${startY - cardH / 2}px`);
    card.style.setProperty("--mid-x", `${midX - cardW / 2}px`);
    card.style.setProperty("--mid-y", `${midY - cardH / 2}px`);
    card.style.setProperty("--near-x", `${nearX - cardW / 2}px`);
    card.style.setProperty("--near-y", `${nearY - cardH / 2}px`);
    card.style.setProperty("--singularity-x", `${singX}px`);
    card.style.setProperty("--singularity-y", `${singY}px`);
    card.style.setProperty("--angle", `${angle}deg`);
    card.style.animationDelay = `${i * 35}ms`;

    const p = paths[i] || paths[0];
    const ext = (p.split(/[\\/]/).pop().split(".").pop() || "FILE").toUpperCase().slice(0, 4);

    const iconSpan = document.createElement("span");
    iconSpan.className = "suck-icon";
    iconSpan.textContent = count > 1 && i === maxCards - 1 ? "🗂️" : getFileIcon(ext);

    const labelSpan = document.createElement("span");
    labelSpan.className = "suck-label";
    labelSpan.textContent = count > 1 && i === maxCards - 1 ? `+${count}` : ext;

    card.append(iconSpan, labelSpan);
    vortexStage.appendChild(card);
  }

  setTimeout(() => {
    vortexStage.replaceChildren();
    b.classList.remove("swallowing");
    if (shockwave) shockwave.classList.remove("burst");
    if (onDone) onDone();
  }, 370);
}

["dragenter", "dragover"].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (!b.classList.contains("over")) {
      if (typeof ZestAudio !== "undefined") ZestAudio.tick(1150);
    }
    b.classList.add("over");
  }),
);
document.addEventListener("dragleave", () => b.classList.remove("over"));
rapi.on("bubble:swallow", () => {
  b.classList.remove("swallowing");
  void b.offsetWidth;
  b.classList.add("swallowing");
  if (shockwave) {
    shockwave.classList.remove("burst");
    void shockwave.offsetWidth;
    shockwave.classList.add("burst");
  }
  if (typeof ZestAudio !== "undefined") ZestAudio.drop();
});

document.addEventListener("drop", (e) => {
  e.preventDefault();
  b.classList.remove("over");
  const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
  const paths = files
    .map((f) => (rapi && rapi.pathFor ? rapi.pathFor(f) : f.path) || f.path)
    .filter(Boolean);
  if (paths.length) {
    rapi.send("bubble:drop", { paths, screenX: e.screenX, screenY: e.screenY });
  }
});
