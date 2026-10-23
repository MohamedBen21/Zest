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
  setTimeout(() => b.classList.remove("pop"), 450);
});
document.querySelectorAll("#sz button").forEach((x) => {
  x.addEventListener("pointerdown", (e) => e.stopPropagation());
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    rapi.send("bubble:size", x.dataset.k);
  });
});
rapi.on("bubble:lang", (l) => {
  b.title = rt(l, "bubbleTip");
});
minBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
minBtn.addEventListener("click", (e) => {
  e.stopPropagation();
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
  if (drag && !moved) rapi.send("bubble:click");
  if (moved) rapi.send("bubble:moved");
  drag = null;
});
b.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  rapi.send("bubble:menu");
});
["dragenter", "dragover"].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    b.classList.add("over");
  }),
);
document.addEventListener("dragleave", () => b.classList.remove("over"));
document.addEventListener("drop", (e) => {
  e.preventDefault();
  b.classList.remove("over");
  const paths = [...e.dataTransfer.files]
    .map((f) => rapi.pathFor(f))
    .filter(Boolean);
  if (paths.length) rapi.send("bubble:drop", paths);
});
