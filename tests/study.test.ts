import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import {
  addMove,
  assertPosition,
  enginePosition,
  gameAt,
  newStudy,
  restoreStudy,
  terminalReason,
} from '../src/lib/study';
import { exportPgn, importPgn } from '../src/lib/pgn';
import { findOpening, positionKey } from '../src/lib/openings';
import { readLibrary, writeLibrary } from '../src/lib/storage';

describe('legal analysis and variations', () => {
  it('creates a branch without replacing the main line and reuses existing moves', () => {
    let study = addMove(newStudy(), 'e4');
    const e4 = study.cursor;
    study = addMove(study, 'e5');
    const e5 = study.cursor;
    study = addMove({ ...study, cursor: e4 }, 'c5');
    expect(study.nodes[e4].children).toEqual([e5, study.cursor]);
    const again = addMove({ ...study, cursor: e4 }, 'e5');
    expect(again.cursor).toBe(e5);
    expect(gameAt(study).history()).toEqual(['e4', 'c5']);
    expect(enginePosition(study)).toMatch(/moves e2e4 c7c5$/);
  });
  it('preserves history for threefold repetition', () => {
    let study = newStudy();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'])
      study = addMove(study, move);
    expect(gameAt(study).isThreefoldRepetition()).toBe(true);
    expect(terminalReason(gameAt(study))).toContain('threefold');
    expect(enginePosition(study)).toContain('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
  });
  it('handles castling, en passant and underpromotion', () => {
    let study = importPgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *');
    expect(gameAt(study).get('g1')?.type).toBe('k');
    expect(gameAt(study).get('f1')?.type).toBe('r');
    study = importPgn('1. e4 a6 2. e5 d5 3. exd6 *');
    expect(gameAt(study).get('d5')).toBeUndefined();
    expect(gameAt(study).get('d6')?.type).toBe('p');
    study = newStudy('7k/P7/8/8/8/8/8/7K w - - 0 1');
    study = addMove(study, { from: 'a7', to: 'a8', promotion: 'n' });
    expect(gameAt(study).get('a8')?.type).toBe('n');
  });
  it('recognizes mate and stalemate', () => {
    expect(terminalReason(gameAt(importPgn('1. f3 e5 2. g4 Qh4# 0-1')))).toContain('Checkmate');
    expect(terminalReason(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toContain('stalemate');
  });
});
describe('position validation', () => {
  it.each([
    '8/8/8/8/8/8/8/8 w - - 0 1',
    '7k/6K1/8/8/8/8/8/8 w - - 0 1',
    '7k/8/8/8/8/8/8/K6R w - - 0 1',
    '7k/8/8/8/8/8/8/K7 w K - 0 1',
    '7k/8/8/8/8/8/8/K7 w - d6 0 1',
    'P6k/8/8/8/8/8/8/K7 w - - 0 1',
  ])('rejects unsafe setup %s', (fen) => expect(() => assertPosition(fen)).toThrow());
  it('accepts a valid custom position with en passant and castling rights', () => {
    const game = new Chess();
    for (const move of ['e4', 'a6', 'e5', 'd5']) game.move(move);
    expect(() => assertPosition(game.fen())).not.toThrow();
  });
});
describe('PGN and notebook round trips', () => {
  const pgn =
    '[Event "Branch study"]\n\n{Root note} 1. e4 {Central control} (1. d4 d5 (1... Nf6) 2. c4) e5 2. Nf3 (2. Bc4 Nf6) Nc6 (2... d6 {Philidor}) 3. Bb5 *';
  it('round-trips nested variations and comments', () => {
    const first = importPgn(pgn);
    const output = exportPgn(first);
    const second = importPgn(output);
    const shape = (study: typeof first) =>
      Object.values(study.nodes)
        .map((n) => `${n.uci}|${n.fen}|${n.comment}`)
        .sort();
    expect(shape(second)).toEqual(shape(first));
    expect(second.headers.Event).toBe('Branch study');
    expect(gameAt(second).history()).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });
  it('exports/imports a Black-to-move setup and preserves comments', () => {
    const study = importPgn(
      '[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 22"]\n\n22... O-O {Safe king} *',
    );
    const restored = importPgn(exportPgn(study));
    expect(restored.rootFen).toBe(study.rootFen);
    expect(gameAt(restored).fen()).toBe(gameAt(study).fen());
  });
  it.each([
    '1. e4 e9',
    '1. e4 (1. d4',
    '1. e4 )',
    '1. e4 {unfinished',
    'not a game',
    '1. e4 * 1. d4',
  ])('rejects malformed input %s', (value) => expect(() => importPgn(value)).toThrow());
  it('rebuilds saved state rather than trusting cached positions', () => {
    const study = importPgn(pgn);
    study.nodes[study.cursor].fen = 'corrupted';
    const restored = restoreStudy(JSON.parse(JSON.stringify(study)));
    expect(restored.nodes[restored.cursor].fen).toBe(gameAt(restored).fen());
    study.nodes.root.children.push('missing');
    expect(() => restoreStudy(study)).toThrow();
  });
  it('rejects cycles and illegal moves in backup files', () => {
    const study = addMove(newStudy(), 'e4');
    study.nodes[study.cursor].children.push('root');
    expect(() => restoreStudy(study)).toThrow();
    study.nodes[study.cursor].children = [];
    study.nodes[study.cursor].uci = 'e2e5';
    expect(() => restoreStudy(study)).toThrow();
  });
  it('restores titles, notes, selected branches and library entries', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
    const study = importPgn(pgn);
    study.title = 'My discovery';
    study.notes = 'Try the Berlin';
    const items = [{ id: 'notebook-1', savedAt: '2026-10-21T12:00:00Z', study }];
    writeLibrary(items, storage);
    expect(readLibrary(storage)).toEqual(items);
  });
  it('reports corrupt or unavailable storage instead of discarding it', () => {
    expect(() => readLibrary({ getItem: () => 'invalid json' })).toThrow();
    expect(() =>
      writeLibrary([], {
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
      }),
    ).toThrow('QuotaExceeded');
  });
});
describe('opening names from bundled data', () => {
  const data = JSON.parse(
    readFileSync(new URL('../public/data/openings.json', import.meta.url), 'utf8'),
  );
  it('recognizes the Ruy Lopez and retains its last named position', () => {
    const study = importPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 *');
    expect(findOpening(study, data)?.name).toContain('Ruy');
    expect(findOpening(addMove(study, 'h5'), data)?.name).toContain('Ruy');
  });
  it('matches transposed positions and ignores move counters', () => {
    const a = importPgn('1. d4 Nf6 2. c4 e6 3. Nc3 d5 *');
    const b = importPgn('1. d4 d5 2. c4 e6 3. Nc3 Nf6 *');
    expect(positionKey(gameAt(a).fen())).toBe(positionKey(gameAt(b).fen()));
    expect(findOpening(a, data)).toEqual(findOpening(b, data));
    expect(findOpening(newStudy(), data)).toBeNull();
  });
});
