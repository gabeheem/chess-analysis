import { type Chess, type Color } from 'chess.js';
import { addMove, gameAt, newStudy, type Study } from './study';
import { positionKey } from './openings';

export type GameOutcome = { result: '1-0' | '0-1' | '1/2-1/2'; reason: string };
export type EngineGame = {
  id: string;
  study: Study;
  human: Color;
  elo: number;
  time: number;
  outcome: GameOutcome | null;
};
export type MoveInput = string | { from: string; to: string; promotion?: string };
export const sideName = (side: Color) => (side === 'w' ? 'White' : 'Black');
export const opposite = (side: Color): Color => (side === 'w' ? 'b' : 'w');
export function chooseSide(choice: Color | 'random', random = Math.random): Color {
  return choice === 'random' ? (random() < 0.5 ? 'w' : 'b') : choice;
}
export function repetitions(game: Chess) {
  const history = game.history({ verbose: true });
  const current = positionKey(game.fen());
  const initial = history[0]?.before ?? game.fen();
  return [initial, ...history.map((move) => move.after)].filter(
    (fen) => positionKey(fen) === current,
  ).length;
}
export function claimableDraw(game: Chess): string | null {
  if (repetitions(game) >= 3) return 'threefold repetition';
  if (Number(game.fen().split(' ')[4]) >= 100) return 'fifty-move rule';
  return null;
}
export function automaticOutcome(game: Chess): GameOutcome | null {
  if (game.isCheckmate())
    return {
      result: game.turn() === 'w' ? '0-1' : '1-0',
      reason: `${sideName(opposite(game.turn()))} wins by checkmate`,
    };
  if (game.isStalemate()) return { result: '1/2-1/2', reason: 'Draw by stalemate' };
  if (game.isInsufficientMaterial())
    return { result: '1/2-1/2', reason: 'Draw by insufficient material' };
  if (repetitions(game) >= 5)
    return { result: '1/2-1/2', reason: 'Automatic draw by fivefold repetition' };
  if (Number(game.fen().split(' ')[4]) >= 150)
    return { result: '1/2-1/2', reason: 'Automatic draw by seventy-five-move rule' };
  return null;
}
export function finishGame(session: EngineGame, outcome: GameOutcome): EngineGame {
  return {
    ...session,
    outcome,
    study: {
      ...session.study,
      headers: { ...session.study.headers, Result: outcome.result, Termination: outcome.reason },
    },
  };
}
function settle(session: EngineGame): EngineGame {
  const game = gameAt(session.study);
  const outcome = automaticOutcome(game);
  if (outcome) return finishGame(session, outcome);
  // The opponent chooses to claim a legal draw on its own turn. Human claims
  // remain optional and are offered as a separate action, not an automatic end.
  const claim = game.turn() !== session.human ? claimableDraw(game) : null;
  return claim
    ? finishGame(session, { result: '1/2-1/2', reason: `Stockfish claims a draw by ${claim}` })
    : session;
}
export function createEngineGame(
  human: Color,
  elo: number,
  time: number,
  study = newStudy(),
): EngineGame {
  const engineName = `Stockfish 19 Lite (~${elo} Elo)`;
  const next: Study = {
    ...study,
    title: `You vs Stockfish · ~${elo} Elo`,
    headers: {
      ...study.headers,
      Event: 'Open File · Play vs Engine',
      White: human === 'w' ? 'You' : engineName,
      Black: human === 'b' ? 'You' : engineName,
      Result: '*',
      EngineEloEstimate: String(elo),
    },
  };
  return settle({ id: crypto.randomUUID(), study: next, human, elo, time, outcome: null });
}
export function gameRequestId(session: EngineGame) {
  return `${session.id}:${session.study.cursor}`;
}
export function canHumanMove(session: EngineGame) {
  return !session.outcome && gameAt(session.study).turn() === session.human;
}
export function humanMove(session: EngineGame, move: MoveInput): EngineGame {
  if (!canHumanMove(session)) throw new Error('Wait for your turn.');
  return settle({ ...session, study: addMove(session.study, move) });
}
export function engineMove(session: EngineGame, move: string, requestId: string): EngineGame {
  if (
    session.outcome ||
    gameAt(session.study).turn() === session.human ||
    requestId !== gameRequestId(session)
  )
    return session;
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
    throw new Error('Stockfish returned no legal move. Retry the engine.');
  return settle({
    ...session,
    study: addMove(session.study, {
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      promotion: move[4],
    }),
  });
}
export function claimDraw(session: EngineGame, intendedMove?: MoveInput): EngineGame {
  if (!canHumanMove(session)) throw new Error('You can claim a draw only on your turn.');
  const game = gameAt(session.study);
  // FIDE also permits a claim based on a stated intended legal move. Do not
  // append that move to the played game: an accepted claim ends it immediately.
  if (intendedMove) game.move(intendedMove);
  const claim = claimableDraw(game);
  if (!claim) throw new Error('There is no valid draw claim for this position or intended move.');
  return finishGame(session, {
    result: '1/2-1/2',
    reason: `You claim a draw by ${claim}${intendedMove ? ' (intended move)' : ''}`,
  });
}
export function resignGame(session: EngineGame): EngineGame {
  if (session.outcome) return session;
  const opponent = opposite(session.human);
  const material = gameAt(session.study)
    .board()
    .flat()
    .filter((piece) => piece?.color === opponent && piece.type !== 'k');
  return finishGame(
    session,
    material.length
      ? {
          result: session.human === 'w' ? '0-1' : '1-0',
          reason: `${sideName(opponent)} wins by resignation`,
        }
      : {
          result: '1/2-1/2',
          reason: 'Draw on resignation: the opponent has only a king and cannot give mate',
        },
  );
}
