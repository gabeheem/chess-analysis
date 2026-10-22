import { Chess, DEFAULT_POSITION, validateFen, type Square } from 'chess.js';

export type MoveNode = {
  id: string;
  parent: string | null;
  children: string[];
  uci: string;
  san: string;
  fen: string;
  comment: string;
};
export type Study = {
  version: 1;
  rootFen: string;
  nodes: Record<string, MoveNode>;
  cursor: string;
  headers: Record<string, string>;
  title: string;
  notes: string;
};
export function newStudy(fen = DEFAULT_POSITION): Study {
  assertPosition(fen);
  fen = new Chess(fen).fen();
  return {
    version: 1,
    rootFen: fen,
    nodes: { root: { id: 'root', parent: null, children: [], uci: '', san: '', fen, comment: '' } },
    cursor: 'root',
    headers: {},
    title: 'Untitled analysis',
    notes: '',
  };
}
export function pathTo(study: Study, id = study.cursor): MoveNode[] {
  const path: MoveNode[] = [];
  let node = study.nodes[id];
  while (node?.parent !== null && node) {
    path.unshift(node);
    node = study.nodes[node.parent!];
  }
  return path;
}
export function gameAt(study: Study, id = study.cursor): Chess {
  const game = new Chess(study.rootFen);
  for (const node of pathTo(study, id))
    game.move({ from: node.uci.slice(0, 2), to: node.uci.slice(2, 4), promotion: node.uci[4] });
  return game;
}
export function addMove(
  study: Study,
  move: string | { from: string; to: string; promotion?: string },
): Study {
  const game = gameAt(study);
  const played = game.move(move);
  if (!played) throw new Error('That move is not legal in this position.');
  const uci = played.from + played.to + (played.promotion ?? '');
  const parent = study.nodes[study.cursor];
  const existing = parent.children.find((id) => study.nodes[id].uci === uci);
  if (existing) return { ...study, cursor: existing };
  if (Object.keys(study.nodes).length >= 10000)
    throw new Error('This notebook has reached its 10,000-position limit. Start another notebook.');
  const id = crypto.randomUUID();
  const node: MoveNode = {
    id,
    parent: parent.id,
    children: [],
    uci,
    san: played.san,
    fen: game.fen(),
    comment: '',
  };
  return {
    ...study,
    cursor: id,
    nodes: {
      ...study.nodes,
      [parent.id]: { ...parent, children: [...parent.children, id] },
      [id]: node,
    },
  };
}
export function moveLabel(fen: string) {
  const parts = fen.split(' ');
  return parts[5] + (parts[1] === 'w' ? '.' : '…');
}
export function terminalReason(game: Chess): string | null {
  if (game.isCheckmate()) return `Checkmate · ${game.turn() === 'w' ? 'Black' : 'White'} wins`;
  if (game.isStalemate()) return 'Draw · stalemate';
  if (game.isThreefoldRepetition()) return 'Draw claim available · threefold repetition';
  if (game.isDrawByFiftyMoves()) return 'Draw claim available · fifty-move rule';
  if (game.isInsufficientMaterial()) return 'Draw · insufficient material';
  return null;
}

// Reject unsafe setups rather than passing impossible positions to the engine.
// This verifies static legality, not whether a position is reachable from move one.
export function assertPosition(fen: string) {
  const result = validateFen(fen);
  if (!result.ok) throw new Error(result.error ?? 'Invalid FEN.');
  const game = new Chess(fen);
  const pieces = game
    .board()
    .flat()
    .filter((p) => p !== null);
  const wk = pieces.find((p) => p.type === 'k' && p.color === 'w')!;
  const bk = pieces.find((p) => p.type === 'k' && p.color === 'b')!;
  const xy = (s: string) => [s.charCodeAt(0) - 97, Number(s[1])];
  const [wx, wy] = xy(wk.square),
    [bx, by] = xy(bk.square);
  if (Math.max(Math.abs(wx - bx), Math.abs(wy - by)) <= 1)
    throw new Error('The kings cannot be adjacent.');
  const previousSide = game.turn() === 'w' ? 'b' : 'w';
  if (game.isAttacked((previousSide === 'w' ? wk : bk).square as Square, game.turn()))
    throw new Error(
      'The side that just moved cannot leave its king in check. Change the side to move or the position.',
    );
  for (const color of ['w', 'b'] as const) {
    const own = pieces.filter((p) => p.color === color);
    if (own.length > 16 || own.filter((p) => p.type === 'p').length > 8)
      throw new Error('A side can have at most 16 pieces and eight pawns.');
    const counts = (t: string) => own.filter((p) => p.type === t).length;
    const promotions =
      Math.max(0, counts('q') - 1) +
      Math.max(0, counts('r') - 2) +
      Math.max(0, counts('b') - 2) +
      Math.max(0, counts('n') - 2);
    if (promotions > 8 - counts('p'))
      throw new Error('Too many promoted pieces for the remaining pawns.');
  }
  const parts = fen.split(/\s+/);
  const required: Record<string, [Square, Square, 'w' | 'b']> = {
    K: ['e1', 'h1', 'w'],
    Q: ['e1', 'a1', 'w'],
    k: ['e8', 'h8', 'b'],
    q: ['e8', 'a8', 'b'],
  };
  for (const right of parts[2]) {
    if (right === '-') continue;
    const [king, rook, color] = required[right];
    if (
      game.get(king)?.type !== 'k' ||
      game.get(king)?.color !== color ||
      game.get(rook)?.type !== 'r' ||
      game.get(rook)?.color !== color
    )
      throw new Error('Castling rights require the king and rook on their original squares.');
  }
  if (parts[3] !== '-') {
    const ep = parts[3];
    const pawnSquare = (ep[0] + (game.turn() === 'w' ? '5' : '4')) as Square;
    const origin = (ep[0] + (game.turn() === 'w' ? '7' : '2')) as Square;
    if (
      game.get(ep as Square) ||
      game.get(origin) ||
      game.get(pawnSquare)?.type !== 'p' ||
      game.get(pawnSquare)?.color !== previousSide ||
      parts[4] !== '0'
    )
      throw new Error(
        'En passant requires a pawn that has just advanced two squares and a halfmove clock of zero.',
      );
  }
}

export function enginePosition(study: Study) {
  const moves = pathTo(study).map((n) => n.uci);
  return `position fen ${study.rootFen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`;
}

// Validate untrusted browser/file data by reconstructing all legal moves.
export function restoreStudy(value: unknown): Study {
  const data = value as Study;
  if (
    !data ||
    data.version !== 1 ||
    !data.nodes ||
    typeof data.title !== 'string' ||
    typeof data.notes !== 'string'
  )
    throw new Error('Not a supported Open File notebook.');
  const study = newStudy(data.rootFen);
  const entries = Object.entries(data.nodes);
  if (entries.length > 10000 || !data.nodes.root || data.nodes.root.parent !== null)
    throw new Error('Invalid notebook structure.');
  const seen = new Set<string>();
  const nodes: Record<string, MoveNode> = {};
  const stack: Array<{ id: string; parent: string | null; fen: string }> = [
    { id: 'root', parent: null, fen: study.rootFen },
  ];
  while (stack.length) {
    const item = stack.pop()!;
    const node = data.nodes[item.id];
    if (
      !node ||
      seen.has(item.id) ||
      !Array.isArray(node.children) ||
      node.parent !== item.parent ||
      typeof node.comment !== 'string'
    )
      throw new Error('Invalid notebook move tree.');
    seen.add(item.id);
    let fen = item.fen,
      san = '',
      uci = '';
    if (item.parent) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(node.uci))
        throw new Error('Invalid notebook move.');
      const game = new Chess(fen);
      const move = game.move({
        from: node.uci.slice(0, 2),
        to: node.uci.slice(2, 4),
        promotion: node.uci[4],
      });
      fen = game.fen();
      san = move.san;
      uci = node.uci;
    }
    nodes[item.id] = {
      id: item.id,
      parent: item.parent,
      children: [...node.children],
      fen,
      uci,
      san,
      comment: node.comment,
    };
    for (const id of node.children) {
      if (typeof id !== 'string') throw new Error('Invalid notebook child identifier.');
      stack.push({ id, parent: item.id, fen });
    }
  }
  if (seen.size !== entries.length || !seen.has(data.cursor))
    throw new Error('Notebook contains disconnected positions.');
  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(data.headers ?? {}))
    if (/^[A-Za-z0-9_]+$/.test(key) && typeof val === 'string') headers[key] = val;
  return { ...study, nodes, cursor: data.cursor, title: data.title, notes: data.notes, headers };
}
