import { useEffect, useRef, useState } from 'react';
import { EngineController, type EngineState, type Transport } from './controller';
export function useEngine(
  position: string,
  turn: 'w' | 'b',
  enabled: boolean,
  time: number,
  terminal: boolean,
  candidateCount = 3,
) {
  const [state, setState] = useState<EngineState>({ status: 'loading', lines: [] });
  const [attempt, retry] = useState(0);
  const controller = useRef<EngineController | null>(null);
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
    if (!enabled || terminal) controller.current?.pause();
    else controller.current?.request(position, turn, time, candidateCount);
  }, [position, turn, enabled, time, terminal, attempt, candidateCount]);
  return {
    ...state,
    lines: state.position === position && enabled && !terminal ? state.lines : [],
    retry: () => retry((n) => n + 1),
  };
}
