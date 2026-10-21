import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';

const base = new URL('../', import.meta.url);
const manifest = { generated: new Date().toISOString(), sources: {}, files: {} };
async function save(path, bytes) {
  const dest = new URL(path, base);
  await mkdir(new URL('.', dest), { recursive: true });
  await writeFile(dest, bytes);
  manifest.files[path] = createHash('sha256').update(bytes).digest('hex');
}
async function get(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'open-file-chess-analysis' },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}
async function revision(repo) {
  const response = await get(`https://api.github.com/repos/${repo}/commits/HEAD`);
  return (await response.json()).sha;
}
const stockfish = 'node_modules/stockfish/';
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  await save(`public/engine/${file}`, await readFile(new URL(`${stockfish}bin/${file}`, base)));
}
await copyFile(new URL(`${stockfish}Copying.txt`, base), new URL('LICENSE', base));
await save(
  'public/licenses/stockfish-GPL-3.0.txt',
  await readFile(new URL(`${stockfish}Copying.txt`, base)),
);
manifest.sources.stockfish = {
  version: '19.0.1',
  source: 'https://github.com/nmrugg/stockfish.js/tree/v19.0.1',
  archive: 'https://github.com/nmrugg/stockfish.js/archive/refs/tags/v19.0.1.tar.gz',
  build: 'lite single-threaded (upstream prebuilt npm artifact)',
};
const openingsSha = await revision('lichess-org/chess-openings');
manifest.sources.openings = {
  revision: openingsSha,
  source: `https://github.com/lichess-org/chess-openings/tree/${openingsSha}`,
  license: 'CC0-1.0',
};
const index = {};
for (const volume of ['a', 'b', 'c', 'd', 'e']) {
  const tsv = await (
    await get(
      `https://raw.githubusercontent.com/lichess-org/chess-openings/${openingsSha}/${volume}.tsv`,
    )
  ).text();
  await save(`data/openings/${volume}.tsv`, tsv);
  for (const row of tsv.trim().split('\n').slice(1)) {
    const [eco, name, pgn] = row.trimEnd().split('\t');
    const game = new Chess();
    game.loadPgn(pgn);
    index[game.fen().split(' ').slice(0, 4).join(' ')] = { eco, name };
  }
}
await save('public/data/openings.json', JSON.stringify(index));
await save(
  'public/licenses/openings-CC0.txt',
  await (
    await get(
      `https://raw.githubusercontent.com/lichess-org/chess-openings/${openingsSha}/COPYING.txt`,
    )
  ).text(),
);
const artSha = await revision('lichess-org/lila');
manifest.sources.pieces = {
  revision: artSha,
  source: `https://github.com/lichess-org/lila/tree/${artSha}/public/piece/cburnett`,
  author: 'Colin M. L. Burnett',
  license: 'GPL-2.0-or-later (use under GPL-3.0-or-later)',
};
await Promise.all(
  ['w', 'b'].flatMap((color) =>
    ['K', 'Q', 'R', 'B', 'N', 'P'].map(async (role) => {
      const file = `${color}${role}.svg`;
      await save(
        `public/pieces/${file}`,
        await (
          await get(
            `https://raw.githubusercontent.com/lichess-org/lila/${artSha}/public/piece/cburnett/${file}`,
          )
        ).text(),
      );
    }),
  ),
);
for (const [name, path] of [
  ['chess.js', 'LICENSE'],
  ['@lichess-org/chessground', 'LICENSE'],
  ['react', 'LICENSE'],
  ['react-dom', 'LICENSE'],
  ['lucide-react', 'LICENSE'],
]) {
  await save(
    `public/licenses/${name.replaceAll('/', '-')}.txt`,
    await readFile(new URL(`node_modules/${name}/${path}`, base)),
  );
}
await save('public/licenses/pieces-GPL-3.0.txt', await readFile(new URL('LICENSE', base)));
await writeFile(
  new URL('public/data/asset-manifest.json', base),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Bundled Stockfish, ${Object.keys(index).length} opening positions, 12 pieces, and licenses.`,
);
