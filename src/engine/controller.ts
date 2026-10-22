export type EngineLine = {
  rank: number;
  depth: number;
  cp?: number;
  mate?: number;
  moves: string[];
};
export type EngineState = {
  status: 'loading' | 'analyzing' | 'paused' | 'ready' | 'complete' | 'error';
  lines: EngineLine[];
  position?: string;
  error?: string;
  eloRange?: EloRange;
  bestMove?: string;
  requestId?: string;
};
export type EloRange = { min: number; max: number; default: number };
export interface Transport {
  postMessage(command: string): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}
type Request = {
  position: string;
  turn: 'w' | 'b';
  time: number;
  count: number;
  elo?: number;
  requestId?: string;
};
export function parseEloRange(text: string): EloRange | null {
  const match = text.match(/^option name UCI_Elo type spin default (\d+) min (\d+) max (\d+)$/);
  if (!match || Number(match[2]) > Number(match[3])) return null;
  return { default: Number(match[1]), min: Number(match[2]), max: Number(match[3]) };
}
export function parseInfo(text: string, turn: 'w' | 'b'): EngineLine | null {
  const depth = text.match(/\bdepth (\d+)/),
    score = text.match(/\bscore (cp|mate) (-?\d+)/),
    pv = text.match(/\bpv (.+)$/);
  if (!depth || !score || !pv || /\b(upperbound|lowerbound)\b/.test(text)) return null;
  const sign = turn === 'w' ? 1 : -1;
  const value = Number(score[2]) * sign;
  return {
    rank: Number(text.match(/\bmultipv (\d+)/)?.[1] ?? 1),
    depth: Number(depth[1]),
    ...(score[1] === 'cp' ? { cp: value } : { mate: value }),
    moves: pv[1].trim().split(/\s+/),
  };
}
export function formatScore(line?: EngineLine) {
  if (!line) return '—';
  if (line.mate !== undefined) return `${line.mate < 0 ? '−' : ''}M${Math.abs(line.mate)}`;
  const score = (line.cp ?? 0) / 100;
  return `${score > 0 ? '+' : ''}${score.toFixed(2)}`;
}

// UCI has no request IDs. A stopped search must finish (bestmove) before
// another position is sent. Output is discarded from the moment stop is sent.
export class EngineController {
  private phase: 'loading' | 'idle' | 'searching' | 'stopping' | 'dead' = 'loading';
  private desired: Request | null = null;
  private active: Request | null = null;
  private lines = new Map<number, EngineLine>();
  private frame = new Map<number, EngineLine>();
  private frameDepth = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private eloRange?: EloRange;
  private limitSupported = false;
  private gameIdentity?: string;
  constructor(
    private worker: Transport,
    private emit: (state: EngineState) => void,
  ) {
    worker.onmessage = (event) => {
      for (const line of String(event.data).split('\n')) this.receive(line.trim());
    };
    worker.onerror = () =>
      this.fail(
        'Stockfish could not start. Check that the engine JS and WASM assets are served locally, then retry.',
      );
    this.publish({ status: 'loading', lines: [] });
    this.arm(30000, 'Stockfish took too long to load. Reload or retry the engine.');
    worker.postMessage('uci');
  }
  private publish(state: EngineState) {
    this.emit({ ...state, eloRange: this.eloRange });
  }
  private arm(ms: number, message: string) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(message), ms);
  }
  private fail(message: string) {
    clearTimeout(this.timer);
    this.phase = 'dead';
    this.worker.terminate();
    this.publish({ status: 'error', lines: [], error: message });
  }
  request(position: string, turn: 'w' | 'b', time: number, count = 3) {
    if (this.phase === 'dead') return;
    this.desired = { position, turn, time, count: Math.max(1, Math.min(3, count)) };
    this.lines.clear();
    this.publish({ status: this.phase === 'loading' ? 'loading' : 'analyzing', lines: [] });
    if (this.phase === 'searching') this.stopSearch();
    else if (this.phase === 'idle') this.start();
  }
  requestPlay(position: string, turn: 'w' | 'b', time: number, elo: number, requestId: string) {
    if (this.phase === 'dead') return;
    this.desired = { position, turn, time, count: 1, elo, requestId };
    this.lines.clear();
    this.publish({
      status: this.phase === 'loading' ? 'loading' : 'analyzing',
      lines: [],
      requestId,
      position,
    });
    if (this.phase === 'searching') this.stopSearch();
    else if (this.phase === 'idle') this.start();
  }
  pause() {
    this.desired = null;
    this.lines.clear();
    if (this.phase === 'dead') return;
    this.publish({ status: 'paused', lines: [] });
    if (this.phase === 'searching') this.stopSearch();
  }
  private stopSearch() {
    this.phase = 'stopping';
    this.worker.postMessage('stop');
    this.arm(10000, 'Stockfish did not stop its previous search. Retry the engine.');
  }
  private start() {
    if (!this.desired || this.phase !== 'idle') return;
    this.active = this.desired;
    this.desired = null;
    this.lines.clear();
    this.frame.clear();
    this.frameDepth = 0;
    this.phase = 'searching';
    if (this.active.elo !== undefined) {
      const elo = this.active.elo;
      if (
        !this.limitSupported ||
        !this.eloRange ||
        !Number.isInteger(elo) ||
        elo < this.eloRange.min ||
        elo > this.eloRange.max
      ) {
        this.fail(
          'The selected Elo is outside this engine’s reported strength range. Restart with a supported rating.',
        );
        return;
      }
      const identity = this.active.requestId?.split(':')[0];
      if (identity !== this.gameIdentity) {
        this.worker.postMessage('ucinewgame');
        this.gameIdentity = identity;
      }
      this.worker.postMessage('setoption name UCI_LimitStrength value true');
      this.worker.postMessage(`setoption name UCI_Elo value ${elo}`);
      this.worker.postMessage('setoption name MultiPV value 1');
    } else {
      this.worker.postMessage('setoption name UCI_LimitStrength value false');
      this.worker.postMessage('setoption name Skill Level value 20');
      this.worker.postMessage('setoption name MultiPV value 3');
    }
    this.worker.postMessage(this.active.position);
    this.worker.postMessage(`go movetime ${this.active.time}`);
    this.arm(this.active.time + 15000, 'Stockfish stopped responding. Retry the engine.');
    this.publish({
      status: 'analyzing',
      lines: [],
      position: this.active.position,
      requestId: this.active.requestId,
    });
  }
  private receive(text: string) {
    if (this.phase === 'dead') return;
    if (this.phase === 'loading') {
      const range = parseEloRange(text);
      if (range) this.eloRange = range;
      if (/^option name UCI_LimitStrength type check\b/.test(text)) this.limitSupported = true;
    }
    if (text === 'uciok' && this.phase === 'loading') {
      this.worker.postMessage('setoption name Hash value 64');
      this.worker.postMessage('setoption name MultiPV value 3');
      this.worker.postMessage('isready');
      return;
    }
    if (text === 'readyok' && this.phase === 'loading') {
      clearTimeout(this.timer);
      this.phase = 'idle';
      if (this.desired) this.start();
      else this.publish({ status: 'paused', lines: [] });
      return;
    }
    if (text.startsWith('bestmove') && (this.phase === 'searching' || this.phase === 'stopping')) {
      clearTimeout(this.timer);
      const wasStopping = this.phase === 'stopping';
      this.phase = 'idle';
      if (this.desired) this.start();
      else if (!wasStopping)
        this.publish({
          status: 'complete',
          lines: this.active?.elo === undefined ? this.sorted() : [],
          position: this.active?.position,
          requestId: this.active?.requestId,
          bestMove: text.split(/\s+/)[1],
        });
      return;
    }
    if (this.phase !== 'searching' || !this.active) return;
    if (this.active.elo !== undefined) return; // Play mode never exposes search hints.
    const line = parseInfo(text, this.active.turn);
    if (line && line.rank >= 1 && line.rank <= this.active.count) {
      if (line.depth < this.frameDepth) return;
      if (line.depth > this.frameDepth) {
        this.frame.clear();
        this.frameDepth = line.depth;
      }
      this.frame.set(line.rank, line);
      // Publish only complete MultiPV iterations so ranks never mix depths.
      if (this.frame.size === this.active.count) {
        this.lines = new Map(this.frame);
        this.publish({ status: 'analyzing', lines: this.sorted(), position: this.active.position });
      }
    }
  }
  private sorted() {
    return [...this.lines.values()].sort((a, b) => a.rank - b.rank);
  }
  destroy() {
    this.phase = 'dead';
    clearTimeout(this.timer);
    this.worker.terminate();
  }
}
