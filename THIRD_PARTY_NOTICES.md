# Third-party notices

Zest's own source code is MIT licensed (see `LICENSE`). The released builds bundle or depend on the components below. Each keeps its own licence; check `package-lock.json` for the exact versions you build.

| Component | Used for | Licence |
|---|---|---|
| [FFmpeg](https://ffmpeg.org) (static build from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/), "release essentials") | audio/video conversion | GPLv3 for this build. Source: https://ffmpeg.org/download.html and https://www.gyan.dev/ffmpeg/builds/. The licence file ships in the app's `bin` folder. |
| [MuPDF](https://mupdf.com) (`mupdf` npm package) | PDF and e-book rendering | AGPL-3.0 (commercial licence available from Artifex) |
| [sharp](https://sharp.pixelplumbing.com) and libvips | image processing | sharp: Apache-2.0. libvips: LGPL-3.0-or-later |
| [pdf-lib](https://pdf-lib.js.org) | PDF editing | MIT |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | DOCX reading | BSD-2-Clause |
| [marked](https://github.com/markedjs/marked) | Markdown rendering | MIT |
| [JSZip](https://stuk.github.io/jszip/) | zip handling | MIT or GPLv3 (dual) |
| [Electron](https://www.electronjs.org) | application shell (includes Chromium) | MIT, plus the Chromium and Node.js licences shipped inside Electron |
| Zest sound effects (`src/**/sounds`) | interface sounds | Original, generated for this project, MIT |
| Zest logo | branding | Copyright (c) 2026 Mohamed Benatallah Benatallah. Not covered by the MIT licence; do not use it to imply an endorsement. |

## Notes
- Because the app distributes AGPL-3.0 (MuPDF) and GPLv3 (FFmpeg) components, anyone receiving the app must also be able to get the corresponding source. This repository provides Zest's source, and the links above provide FFmpeg's.
- If you fork Zest and redistribute it, keep this file and `LICENSE`, and keep your own source public.
- This file is a good-faith summary, not legal advice.
