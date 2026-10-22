# Implementation verification

Performed on Windows, Node 24.18.0, on 2026-10-21.

## Automated

- `npm test`: 31 passing tests, including the real Stockfish 19 Lite single-threaded WebAssembly engine.
- `npm run build`: TypeScript and production Vite build pass.
- `npm install`: no audit vulnerabilities reported at the selected lockfile.
- Same-depth MultiPV candidates, stale-search fencing, engine failure timeout, White-oriented numeric/mate scores.
- Legal castling, en passant, underpromotion, mate, stalemate, repetition history, and invalid setups.
- Main line preservation and branch reuse, nested PGN/comment export/import, setup PGN, malformed input, safe JSON restoration, library round-trip, quota/corrupt storage behavior.
- Bundled opening recognition, last recognized opening retention, and transposition matching.

## Browser smoke checks

- Local Vite page loads; actual engine worker produces three candidate lines with depth and arrows; no browser errors were observed.
- Ruy Lopez sample imports with its Berlin variation and C90 opening recognition.
- Clicking h2 then h3 moves the pawn, advances history, updates opening identification, and starts Black-to-move analysis.
- Notebook title/notes save, library entry appears, and the workspace restores after reload; saved notebook reopens from the library.
- Invalid FEN is rejected with an inline error.
- A custom promotion FEN loads; moving a7–a8 opens the promotion selector; selecting a knight produces a8=N and correctly reports insufficient material.
- Desktop layout at the default 1280×720 browser viewport fits the full board; phone layout at 390×844 stacks the board and analysis without horizontal overflow.
- Production build served at `/chess-analysis/` loads piece artwork, opening data, and the real worker/WASM engine and produces all three candidate lines without browser errors.

## Limits of verification

The 2026-10-22 layout update was also checked in the user's 903×571 browser window: the 397-pixel board ends at pixel 559, the opening heading is visible above it, and the page is at scroll position zero. Observed layout measurements adjust the board when the window or opening heading changes.

Only the available Chromium-based in-app browser was exercised manually. Safari, Firefox, touch gestures on physical devices, and very large PGN libraries were not exercised. Static-host deployment is not performed. Production-subdirectory behavior was checked locally; the actual host's MIME types and caching should be checked before publishing.

## Play vs Engine update · 2026-10-22

- Runtime UCI handshake reports Elo 1320–3190 and strength-limiting support. Real-engine tests produce legal replies at both endpoints.
- Unit/protocol checks cover human/engine turns for both colors, illegal/stale/duplicate results, restarts at the same position, cancellation and worker teardown, special moves, mate/stalemate/material endings, threefold versus fivefold, fifty versus seventy-five moves, intended-move claims, resignation, PGN results, and strength reset before analysis.
- Live browser: Black receives an automatic opening move; e7–e5 triggers a legal engine reply. White e2–e4 triggers thinking and e7–e5. A restart during a three-second opening search leaves a fresh White game at zero plies. Returning to analysis preserves the existing eleven-ply workspace.
- Completed game saves to the notebook with its result. Browser download-event inspection is unavailable in this in-app browser; PGN content and result headers are checked by automated tests.
- Final automated result: `npm test` passes 52 tests across three files; `npm run build` passes TypeScript and Vite production compilation.
- Optional **Show analysis** was enabled in a live game: a +0.33 evaluation, three depth-15 candidate lines, and arrows appeared. Disabling it hides the panel/hints. A protocol test checks that its separate full-strength controller neither changes nor cancels the opponent search.
- Resigning and choosing **Analyze this game** opens the normal analysis workspace. Original saved analysis was restored afterward; play setup is left ready for a new game.
