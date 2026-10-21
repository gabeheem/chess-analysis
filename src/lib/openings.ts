import { type Study, pathTo } from './study';
export type Opening = { eco: string; name: string };
export type OpeningMap = Record<string, Opening>;
// chess.js normalizes irrelevant en passant targets. Keep side and castling rights.
export function positionKey(fen: string) {
  return fen.split(' ').slice(0, 4).join(' ');
}
export function findOpening(study: Study, index: OpeningMap): Opening | null {
  for (const fen of [
    ...pathTo(study)
      .map((n) => n.fen)
      .reverse(),
    study.rootFen,
  ]) {
    const found = index[positionKey(fen)];
    if (found) return found;
  }
  return null;
}
