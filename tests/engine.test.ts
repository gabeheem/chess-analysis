import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  EngineController,
  parseInfo,
  formatScore,
  type EngineState,
  type Transport,
} from '../src/engine/controller';
class FakeWorker implements Transport {
  commands: string[] = [];
  onmessage: Transport['onmessage'] = null;
  onerror: Transport['onerror'] = null;
  terminated = false;
  postMessage(command: string) {
    this.commands.push(command);
  }
  terminate() {
    this.terminated = true;
  }
  send(text: string) {
    this.onmessage?.({ data: text });
  }
}
afterEach(() => vi.useRealTimers());
describe('engine protocol and scores', () => {
  it('normalizes Black-to-move scores to White and distinguishes mate', () => {
    const line = 'info depth 15 multipv 2 score cp 134 nodes 900 pv e7e5 g1f3';
    expect(parseInfo(line, 'b')?.cp).toBe(-134);
    expect(formatScore(parseInfo(line, 'b')!)).toBe('-1.34');
    expect(formatScore(parseInfo('info depth 5 score mate -3 pv h8h7', 'b')!)).toBe('M3');
    expect(parseInfo('info depth 5 score cp 15 lowerbound pv e2e4', 'w')).toBeNull();
  });
  it('queues the latest position during loading and ignores stopped search output', () => {
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    const engine = new EngineController(worker, (state) => states.push(state));
    engine.request('position startpos', 'w', 1000, 1);
    engine.request('position fen latest', 'b', 1000, 1);
    worker.send('uciok');
    worker.send('readyok');
    expect(worker.commands).toContain('position fen latest');
    expect(worker.commands).not.toContain('position startpos');
    worker.send('info depth 8 score cp 100 pv e7e5');
    expect(states.at(-1)?.lines[0].cp).toBe(-100);
    engine.request('position fen next', 'w', 1000);
    expect(states.at(-1)?.lines).toEqual([]);
    expect(worker.commands.at(-1)).toBe('stop');
    worker.send('info depth 18 score cp 700 pv e7e5');
    expect(states.at(-1)?.lines).toEqual([]);
    engine.request('position fen newest', 'w', 1000, 1);
    worker.send('bestmove e7e5');
    expect(worker.commands.at(-2)).toBe('position fen newest');
    expect(worker.commands).not.toContain('position fen next');
    worker.send('info depth 9 score cp 35 pv d2d4');
    expect(states.at(-1)?.position).toBe('position fen newest');
    expect(states.at(-1)?.lines[0].cp).toBe(35);
    engine.destroy();
  });
  it('pause discards subsequent output and a stopped search never completes the new position', () => {
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    const engine = new EngineController(worker, (state) => states.push(state));
    worker.send('uciok');
    worker.send('readyok');
    engine.request('position startpos', 'w', 1000);
    engine.pause();
    worker.send('info depth 8 score cp 33 pv e2e4');
    worker.send('bestmove e2e4');
    expect(states.at(-1)?.status).toBe('paused');
    expect(states.at(-1)?.lines).toEqual([]);
    engine.destroy();
  });
  it('publishes matching-depth candidate groups instead of mixing search iterations', () => {
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    const engine = new EngineController(worker, (state) => states.push(state));
    worker.send('uciok');
    worker.send('readyok');
    engine.request('position startpos', 'w', 1000);
    for (const rank of [1, 2, 3])
      worker.send(`info depth 8 multipv ${rank} score cp ${40 - rank} pv e2e4`);
    expect(states.at(-1)?.lines).toHaveLength(3);
    worker.send('info depth 9 multipv 1 score cp 52 pv d2d4');
    expect(states.at(-1)?.lines.every((l) => l.depth === 8)).toBe(true);
    worker.send('bestmove d2d4');
    expect(states.at(-1)?.lines.every((l) => l.depth === 8)).toBe(true);
    engine.destroy();
  });
  it('reports load failures and protocol timeouts and terminates the worker', () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    new EngineController(worker, (state) => states.push(state));
    vi.advanceTimersByTime(30001);
    expect(states.at(-1)?.status).toBe('error');
    expect(worker.terminated).toBe(true);
  });
});
it('runs the bundled real WASM engine through the same controller and finds mate in one', async () => {
  const require = createRequire(import.meta.url);
  const stockfish = require('stockfish');
  const worker: Transport = {
    postMessage: () => {},
    terminate: () => {},
    onmessage: null,
    onerror: null,
  };
  // Browser Worker messages are asynchronous. Emulate that boundary around
  // the Node entrypoint, whose listener otherwise permits reentrant UCI calls.
  const raw = stockfish('lite-single', (line: string) =>
    setImmediate(() => worker.onmessage?.({ data: line })),
  );
  worker.postMessage = (command) => raw.processCommand(command);
  worker.terminate = () => raw.terminate();
  let engine: EngineController | undefined;
  try {
    const state = await new Promise<EngineState>((resolve, reject) => {
      engine = new EngineController(worker, (state) => {
        if (state.status === 'complete') resolve(state);
        if (state.status === 'error') reject(new Error(state.error));
      });
      engine.request('position fen 7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', 'w', 300);
    });
    expect(state.lines[0]?.mate).toBe(1);
    expect(state.lines[0]?.moves[0]).toMatch(/^f7/);
    expect(state.lines.length).toBe(3);
  } finally {
    engine?.destroy();
    raw.terminate();
  }
}, 30000);
