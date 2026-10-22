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
