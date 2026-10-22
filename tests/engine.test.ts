import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EngineController,
  parseInfo,
  formatScore,
  parseEloRange,
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
function realWorker() {
  // Each integration check gets an isolated copy of the shipped engine. The
  // upstream Node factory mutates its module and cannot safely be reused.
  const child = spawn(
    process.execPath,
    [
      '--input-type=commonjs',
      '-e',
      "const engine=require('stockfish')('lite-single',line=>process.stdout.write(line+'\\n'));require('node:readline').createInterface({input:process.stdin}).on('line',line=>engine.processCommand(line));",
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const commands: string[] = [];
  let buffer = '';
  let stopped = false;
  const worker: Transport = {
    onmessage: null,
    onerror: null,
    postMessage: (command) => {
      commands.push(command);
      child.stdin.write(command + '\n');
    },
    terminate: () => {
      stopped = true;
      child.kill();
    },
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop()!;
    for (const line of lines) worker.onmessage?.({ data: line });
  });
  child.on('error', (error) => worker.onerror?.(error));
  child.on('exit', (code) => {
    if (!stopped && code !== 0) worker.onerror?.(new Error(`Engine exited ${code}`));
  });
  child.stderr.on('data', () => {});
  return { worker, commands };
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

describe('strength-limited game protocol', () => {
  function ready(worker: FakeWorker) {
    worker.send('option name UCI_LimitStrength type check default false');
    worker.send('option name UCI_Elo type spin default 1320 min 1320 max 3190');
    worker.send('uciok');
    worker.send('readyok');
  }
  it('reads the actual range, hides hints, and returns the selected bestmove rather than the top PV', () => {
    expect(parseEloRange('option name UCI_Elo type spin default 1320 min 1320 max 3190')).toEqual({
      min: 1320,
      max: 3190,
      default: 1320,
    });
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    const engine = new EngineController(worker, (s) => states.push(s));
    ready(worker);
    engine.requestPlay('position startpos', 'w', 500, 1400, 'game-1:root');
    expect(worker.commands).toContain('setoption name UCI_LimitStrength value true');
    expect(worker.commands).toContain('setoption name UCI_Elo value 1400');
    worker.send('info depth 10 score cp 30 pv e2e4');
    expect(states.at(-1)?.lines).toEqual([]);
    worker.send('bestmove d2d4 ponder d7d5');
    expect(states.at(-1)?.bestMove).toBe('d2d4');
    expect(states.at(-1)?.requestId).toBe('game-1:root');
    expect(states.at(-1)?.eloRange?.max).toBe(3190);
    engine.destroy();
  });
  it('fences a restarted game even when the initial position is identical', () => {
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    const engine = new EngineController(worker, (s) => states.push(s));
    ready(worker);
    engine.requestPlay('position startpos', 'w', 500, 1320, 'old:root');
    engine.requestPlay('position startpos', 'w', 500, 2000, 'new:root');
    worker.send('bestmove e2e4');
    expect(states.at(-1)?.status).toBe('analyzing');
    expect(states.at(-1)?.bestMove).toBeUndefined();
    expect(worker.commands).toContain('setoption name UCI_Elo value 2000');
    worker.send('bestmove c2c4');
    expect(states.at(-1)?.requestId).toBe('new:root');
    expect(states.at(-1)?.bestMove).toBe('c2c4');
    engine.destroy();
  });
  it('disables strength limiting and restores maximum skill when returning to analysis', () => {
    const worker = new FakeWorker();
    const engine = new EngineController(worker, () => {});
    ready(worker);
    engine.requestPlay('position startpos', 'w', 500, 1320, 'game:root');
    engine.request('position startpos', 'w', 500, 3);
    worker.send('bestmove e2e4');
    expect(worker.commands.slice(-5)).toEqual([
      'setoption name UCI_LimitStrength value false',
      'setoption name Skill Level value 20',
      'setoption name MultiPV value 3',
      'position startpos',
      'go movetime 500',
    ]);
    engine.destroy();
  });
  it('rejects unsupported ratings rather than faking the chosen strength', () => {
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    const engine = new EngineController(worker, (s) => states.push(s));
    ready(worker);
    engine.requestPlay('position startpos', 'w', 500, 800, 'game:root');
    expect(states.at(-1)?.status).toBe('error');
    expect(worker.terminated).toBe(true);
  });
  it('keeps optional full-strength hints isolated from the opponent search', () => {
    const opponentWorker = new FakeWorker(),
      hintWorker = new FakeWorker();
    const opponentStates: EngineState[] = [],
      hintStates: EngineState[] = [];
    const opponent = new EngineController(opponentWorker, (state) => opponentStates.push(state));
    const hints = new EngineController(hintWorker, (state) => hintStates.push(state));
    ready(opponentWorker);
    ready(hintWorker);
    opponent.requestPlay('position startpos', 'w', 1500, 1400, 'game:root');
    const opponentCommands = [...opponentWorker.commands];
    hints.request('position startpos', 'w', 1500, 1);
    hintWorker.send('info depth 12 score cp 30 pv d2d4');
    expect(hintStates.at(-1)?.lines[0].moves[0]).toBe('d2d4');
    expect(hintWorker.commands).toContain('setoption name UCI_LimitStrength value false');
    expect(opponentWorker.commands).toEqual(opponentCommands);
    hints.destroy(); // Turning hints off must not cancel the opponent.
    expect(opponentWorker.terminated).toBe(false);
    opponentWorker.send('bestmove e2e4');
    expect(opponentStates.at(-1)?.bestMove).toBe('e2e4');
    opponent.destroy();
  });
  it('ignores all results after leaving the game and terminating the worker', () => {
    const worker = new FakeWorker();
    const states: EngineState[] = [];
    const engine = new EngineController(worker, (s) => states.push(s));
    ready(worker);
    engine.requestPlay('position startpos', 'w', 500, 1500, 'game:root');
    engine.destroy();
    const count = states.length;
    worker.send('bestmove e2e4');
    expect(states).toHaveLength(count);
  });
});

it.each([1320, 3190])(
  'plays a legal real WASM move at the supported Elo boundary %i',
  async (elo) => {
    const { worker, commands } = realWorker();
    let engine: EngineController | undefined;
    try {
      const result = await new Promise<EngineState>((resolve, reject) => {
        engine = new EngineController(worker, (state) => {
          if (state.status === 'complete') resolve(state);
          if (state.status === 'error') reject(new Error(state.error));
        });
        engine.requestPlay('position startpos', 'w', 200, elo, `real-${elo}:root`);
      });
      expect(result.eloRange).toEqual({ min: 1320, max: 3190, default: 1320 });
      expect(result.bestMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
      expect(result.lines).toEqual([]);
      const { Chess } = await import('chess.js');
      const game = new Chess();
      const move = result.bestMove!;
      expect(() =>
        game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }),
      ).not.toThrow();
      expect(commands).toContain(`setoption name UCI_Elo value ${elo}`);
      expect(commands).toContain('setoption name UCI_LimitStrength value true');
    } finally {
      engine?.destroy();
      worker.terminate();
    }
  },
  30000,
);
it('runs the bundled real WASM engine through the same controller and finds mate in one', async () => {
  const { worker } = realWorker();
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
    worker.terminate();
  }
}, 30000);
