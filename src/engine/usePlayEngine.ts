import { useEffect, useRef, useState } from 'react';
import { EngineController, type EngineState, type Transport } from './controller';
import { type EngineGame, gameRequestId, canHumanMove } from '../lib/engineGame';
import { enginePosition, gameAt } from '../lib/study';

export function usePlayEngine(session: EngineGame | null) {
  const [state, setState] = useState<EngineState>({ status: 'loading', lines: [] });
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<EngineController | null>(null);
  const position = session ? enginePosition(session.study) : '';
  const requestId = session ? gameRequestId(session) : '';
  const shouldMove = !!session && !session.outcome && !canHumanMove(session);
  const elo = session?.elo ?? 0,
    time = session?.time ?? 1500;
  const turn = session ? gameAt(session.study).turn() : 'w';
  useEffect(() => {
    try {
      const worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
      controller.current = new EngineController(worker as unknown as Transport, setState);
    } catch {
      setState({
        status: 'error',
        lines: [],
        error: 'This browser could not create a local Stockfish worker.',
      });
    }
    return () => {
      controller.current?.destroy();
      controller.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    if (shouldMove) controller.current?.requestPlay(position, turn, time, elo, requestId);
    else controller.current?.pause();
  }, [position, turn, time, elo, requestId, shouldMove, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
