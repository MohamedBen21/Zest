"use strict";
// Plays Zest custom sound effects from sounds/ (100% offline local WAV files)
(function (global) {
  let enabled = true;

  const SOUND_FILES = {
    tick: "sounds/tick.wav",
    click: "sounds/click.wav",
    summon: "sounds/summon.wav",
    dismiss: "sounds/dismiss.wav",
    "swoosh-in": "sounds/swoosh-in.wav",
    "swoosh-out": "sounds/swoosh-out.wav",
    pop: "sounds/pop.wav",
    "pop-close": "sounds/pop-close.wav",
    success: "sounds/success.wav",
    deny: "sounds/deny.wav",
    snap: "sounds/snap.wav",
  };

  const pool = {};
  if (typeof Audio !== "undefined") {
    for (const [key, src] of Object.entries(SOUND_FILES)) {
      try {
        const a = new Audio(src);
        a.preload = "auto";
        pool[key] = [a];
      } catch (_) {}
    }
  }

  function play(name, volume = 0.8) {
    if (!enabled) return;
    try {
      const list = pool[name];
      if (!list || !list.length) {
        const a = new Audio(SOUND_FILES[name]);
        a.volume = volume;
        a.play().catch(() => {});
        return;
      }
      let audio = list.find((a) => a.paused || a.ended);
      if (!audio) {
        audio = list[0].cloneNode(true);
        if (list.length < 6) list.push(audio);
      }
      audio.currentTime = 0;
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.play().catch(() => {});
    } catch (_) {}
  }

  const ZestAudio = {
    get enabled() { return enabled; },
    set enabled(val) { enabled = !!val; },

    play(name, vol) { play(name, vol); },
    tick(vol = 0.75) { play("tick", vol); },
    click(vol = 0.8) { play("click", vol); },
    hit(vol = 0.85) { play("click", vol); },
    confirm(vol = 0.8) { play("click", vol); },
    activate(vol = 0.8) { play("click", vol); },
    expand(vol = 0.75) { play("click", vol); },
    summon(vol = 0.8) { play("summon", vol); },
    dismiss(vol = 0.75) { play("dismiss", vol); },
    back(vol = 0.75) { play("dismiss", vol); },
    drop(vol = 0.85) { play("swoosh-in", vol); },
    swooshIn(vol = 0.85) { play("swoosh-in", vol); },
    swooshOut(vol = 0.8) { play("swoosh-out", vol); },
    pop(vol = 0.8) { play("pop", vol); },
    popClose(vol = 0.75) { play("pop-close", vol); },
    complete(vol = 0.85) { play("success", vol); },
    success(vol = 0.85) { play("success", vol); },
    deny(vol = 0.85) { play("deny", vol); },
    snap(vol = 0.8) { play("snap", vol); },
    tab(vol = 0.7) { play("tick", vol); },
  };

  global.ZestAudio = ZestAudio;
  if (typeof module !== "undefined" && module.exports) module.exports = ZestAudio;
})(typeof window !== "undefined" ? window : globalThis);
