import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { importPgn, exportPgn } from '../src/lib/pgn';
import { gameAt, newStudy } from '../src/lib/study';
import {
  automaticOutcome,
  canHumanMove,
  chooseSide,
  claimDraw,
  claimableDraw,
  createEngineGame,
  engineMove,
  gameRequestId,
  humanMove,
  repetitions,
  resignGame,
} from '../src/lib/engineGame';

describe('playing a strength-limited opponent', () => {
  it('lets White move first and locks human pieces during the engine turn', () => {
    let session = createEngineGame('w', 1500, 500);
    expect(canHumanMove(session)).toBe(true);
    session = humanMove(session, 'e4');
    expect(canHumanMove(session)).toBe(false);
    expect(() => humanMove(session, 'e5')).toThrow('Wait for your turn');
    session = engineMove(session, 'c7c5', gameRequestId(session));
    expect(gameAt(session.study).history()).toEqual(['e4', 'c5']);
    expect(canHumanMove(session)).toBe(true);
  });
  it('has the engine open when the human chooses Black', () => {
    let session = createEngineGame('b', 1320, 500);
    expect(canHumanMove(session)).toBe(false);
    session = engineMove(session, 'd2d4', gameRequestId(session));
    expect(canHumanMove(session)).toBe(true);
    expect(gameAt(session.study).turn()).toBe('b');
  });
  it('supports both random side outcomes and explicit side choices', () => {
    expect(chooseSide('random', () => 0.1)).toBe('w');
    expect(chooseSide('random', () => 0.9)).toBe('b');
    expect(chooseSide('b', () => 0.1)).toBe('b');
  });
  it('ignores duplicate results and moves from a game that was restarted', () => {
    const old = createEngineGame('b', 1500, 500);
    const restarted = createEngineGame('b', 2000, 500);
    expect(engineMove(restarted, 'e2e4', gameRequestId(old))).toBe(restarted);
    const played = engineMove(restarted, 'e2e4', gameRequestId(restarted));
    expect(engineMove(played, 'd2d4', gameRequestId(restarted))).toBe(played);
    expect(gameAt(played.study).history()).toEqual(['e4']);
  });
  it('rejects illegal engine moves and accepts an underpromotion', () => {
    const session = createEngineGame('b', 1320, 500);
    expect(() => engineMove(session, 'e2e5', gameRequestId(session))).toThrow();
    expect(() => engineMove(session, '(none)', gameRequestId(session))).toThrow('no legal move');
    const setup = createEngineGame('w', 1320, 500, newStudy('7k/P7/8/8/8/8/8/7K w - - 0 1'));
    const promoted = humanMove(setup, { from: 'a7', to: 'a8', promotion: 'n' });
    expect(gameAt(promoted.study).get('a8')?.type).toBe('n');
    expect(promoted.outcome?.reason).toContain('insufficient material');
  });
  it('supports castling and en passant during games', () => {
    const castle = createEngineGame('w', 1500, 500, importPgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 *'));
    const castled = humanMove(castle, 'O-O');
    expect(gameAt(castled.study).get('g1')?.type).toBe('k');
    expect(gameAt(castled.study).get('f1')?.type).toBe('r');
    const ep = createEngineGame('w', 1500, 500, importPgn('1. e4 a6 2. e5 d5 *'));
    const captured = humanMove(ep, 'exd6');
    expect(gameAt(captured.study).get('d5')).toBeUndefined();
    expect(gameAt(captured.study).get('d6')?.type).toBe('p');
  });
  it('ends on checkmate, blocks further moves, and exports a correct result', () => {
    let session = createEngineGame('w', 1500, 500);
    session = humanMove(session, 'f3');
    session = engineMove(session, 'e7e5', gameRequestId(session));
    session = humanMove(session, 'g4');
    session = engineMove(session, 'd8h4', gameRequestId(session));
    expect(session.outcome?.result).toBe('0-1');
    expect(session.outcome?.reason).toContain('checkmate');
    expect(canHumanMove(session)).toBe(false);
    expect(() => humanMove(session, 'a3')).toThrow();
    expect(gameAt(importPgn(exportPgn(session.study))).history()).toEqual([
      'f3',
      'e5',
      'g4',
      'Qh4#',
    ]);
    expect(session.study.headers.Result).toBe('0-1');
  });
  it('records resignation and ignores late engine results', () => {
    let session = humanMove(createEngineGame('w', 1500, 500), 'e4');
    const pending = gameRequestId(session);
    session = resignGame(session);
    expect(session.outcome?.result).toBe('0-1');
    expect(engineMove(session, 'e7e5', pending)).toBe(session);
    expect(session.study.headers.Termination).toContain('resignation');
  });
});
describe('automatic versus claimable draws', () => {
  const repeat = (cycles: number) => {
    const game = new Chess();
    for (let i = 0; i < cycles; i++)
      for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(move);
    return game;
  };
  it('threefold is claimable; fivefold is automatic', () => {
    const three = repeat(2);
    expect(repetitions(three)).toBe(3);
    expect(claimableDraw(three)).toBe('threefold repetition');
    expect(automaticOutcome(three)).toBeNull();
    expect(automaticOutcome(repeat(4))?.reason).toContain('fivefold');
  });
  it('fifty moves is claimable; seventy-five is automatic', () => {
    const fifty = new Chess('7k/8/8/8/8/8/8/KR6 w - - 100 90');
    expect(claimableDraw(fifty)).toBe('fifty-move rule');
    expect(automaticOutcome(fifty)).toBeNull();
    expect(automaticOutcome(new Chess('7k/8/8/8/8/8/8/KR6 w - - 150 90'))?.reason).toContain(
      'seventy-five',
    );
  });
  it('allows a human claim and an intended-move claim without appending an unplayed move', () => {
    const session = createEngineGame('w', 1500, 500, importPgn(repeat(2).pgn()));
    expect(session.outcome).toBeNull();
    expect(claimDraw(session).outcome?.result).toBe('1/2-1/2');
    const intended = createEngineGame(
      'b',
      1500,
      500,
      importPgn('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 *'),
    );
    const claimed = claimDraw(intended, 'Ng8');
    expect(claimed.outcome?.reason).toContain('intended move');
    expect(gameAt(claimed.study).history()).toHaveLength(7);
    expect(() => claimDraw(createEngineGame('w', 1500, 500), 'e4')).toThrow('no valid draw claim');
  });
  it('the engine may claim a draw on its turn instead of playing on', () => {
    const session = createEngineGame('b', 1500, 500, importPgn(repeat(2).pgn()));
    expect(session.outcome?.reason).toContain('Stockfish claims');
  });
  it('recognizes stalemate, insufficient material, and mate before the 75-move limit', () => {
    expect(automaticOutcome(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))?.reason).toContain(
      'stalemate',
    );
    expect(automaticOutcome(new Chess('7k/8/8/8/8/8/8/K7 w - - 0 1'))?.reason).toContain(
      'insufficient',
    );
    expect(automaticOutcome(new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 150 90'))?.reason).toContain(
      'checkmate',
    );
  });
});
