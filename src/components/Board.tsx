import { useEffect, useLayoutEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key, Color } from '@lichess-org/chessground/types';
import type { Chess } from 'chess.js';

type Props = {
  game: Chess;
  orientation: Color;
  lastMove?: string;
  arrows: string[];
  onMove: (from: string, to: string) => void;
  disabled?: boolean;
};
export default function Board({ game, orientation, lastMove, arrows, onMove, disabled }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const callback = useRef(onMove);
  callback.current = onMove;
  useLayoutEffect(() => {
    api.current = Chessground(element.current!, {
      animation: { enabled: true, duration: 180 },
      premovable: { enabled: false },
      drawable: { enabled: true },
      movable: {
        free: false,
        rookCastle: false,
        events: { after: (from, to) => callback.current(from, to) },
      },
    });
    return () => {
      api.current?.destroy();
      api.current = null;
    };
  }, []);
  useEffect(() => {
    const dests = new Map<Key, Key[]>();
    for (const move of game.moves({ verbose: true })) {
      const key = move.from as Key;
      dests.set(key, [...new Set([...(dests.get(key) ?? []), move.to as Key])]);
    }
    api.current?.set({
      fen: game.fen(),
      orientation,
      turnColor: game.turn() === 'w' ? 'white' : 'black',
      check: game.isCheck(),
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : [],
      movable: {
        color: disabled ? undefined : game.turn() === 'w' ? 'white' : 'black',
        dests: disabled ? new Map() : dests,
      },
    });
  }, [game, orientation, lastMove, disabled]);
  useEffect(() => {
    api.current?.setAutoShapes(
      arrows
        .filter((m) => /^[a-h][1-8][a-h][1-8]/.test(m))
        .map((m, index) => ({
          orig: m.slice(0, 2) as Key,
          dest: m.slice(2, 4) as Key,
          brush: index === 0 ? 'green' : 'blue',
          modifiers: { lineWidth: index === 0 ? 9 : 5 },
        })),
    );
  }, [arrows]);
  return (
    <div
      className="board-surface"
      ref={element}
      aria-label={`Chessboard, ${game.turn() === 'w' ? 'White' : 'Black'} to move`}
    />
  );
}
