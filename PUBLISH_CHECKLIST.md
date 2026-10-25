# Publish checklist (not part of the repo; delete after use)

## Before you push
- [ ] Copy these files into your repo, overwriting: `README.md`, `package.json`, `build/afterPack.js`. Add: `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/*`.
- [ ] **Retake stale screenshots** in `docs/`: `convert.png`, `image.png` and `tools.png` still say "Mohamed Convert" with the old logo. `bubble.png` is a blown-up, blurry icon: capture the real bubble on a desktop instead. The wheel images and `toast.png` are fine.
- [ ] Record `docs/demo.gif` (10-15 s: bubble → drop a file → wheel → converted file). Free tools: ScreenToGif or ShareX. Keep it under 5 MB.
- [ ] The README and CI link to https://github.com/MohamedBen21/zest-reader. Make sure that repo exists and is public (and has the v1.1.0 release), or the CI Reader step fails.
- [ ] `RELEASE_NOTES.md` still starts with the 1.3.0 notes. Add a section for what is new now (bubble sizes, summon, sounds, maximized window, Zest rename).
- [ ] Optional cleanup: the sound files exist three times (`src/sounds`, `src/renderer/sounds`, `src/radial/sounds`, about 330 KB each). Harmless, but one shared folder is tidier.
- [ ] Decide whether the logo stays all rights reserved (as written in THIRD_PARTY_NOTICES.md) or MIT. Edit that line if you want it free to reuse.

## Licence (read once)
Your LICENSE is MIT, but the app bundles MuPDF (AGPL-3.0) and a GPLv3 FFmpeg build. Publishing the complete source publicly, as you plan, is what makes this fine. The README now says exactly that. If you ever want to ship closed source or sell it, you would need a commercial MuPDF licence from Artifex and an LGPL FFmpeg build. For legal certainty, ask a lawyer.
Also confirm the original "Mamba Convert" repo is MIT; your LICENSE credits its author but I could not re-check the upstream licence from here.

## Repo settings (GitHub → Settings)
- Description: "Offline file converter for Windows: floating bubble + right-click radial wheel. Images, video, audio, PDF, e-books."
- Topics: `electron` `windows` `file-converter` `ffmpeg` `offline` `privacy` `productivity` `pdf` `video-converter` `image-converter`
- Social preview: upload the wheel image or the logo (1280x640).
- Enable Issues and Discussions. Pin a "Feature ideas" discussion.

## First release
1. Tag: `git tag v1.3.0 && git push origin v1.3.0` (the workflow builds and publishes the Release).
2. Open the Release and check that `Zest-Setup`, `Zest-Portable` and the zip are attached.
3. Download and test the installer on a clean Windows account before announcing.

## After launch
- Reply to every issue in the first two weeks.
- Submit to winget (`wingetcreate`) and Scoop once you have a stable release.
- Apply for free signing at https://signpath.org to remove the SmartScreen warning.
