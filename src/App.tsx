import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color } from 'chess.js';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Download,
  FileInput,
  FolderOpen,
  Github,
  Info,
  Lightbulb,
  LoaderCircle,
  NotebookPen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Board from './components/Board';
import Dialog from './components/Dialog';
import MoveTree from './components/MoveTree';
import PositionEditor from './components/PositionEditor';
import {
  addMove,
  enginePosition,
  gameAt,
  moveLabel,
  newStudy,
  pathTo,
  restoreStudy,
  terminalReason,
  type Study,
} from './lib/study';
import { exportPgn, importPgn } from './lib/pgn';
import { findOpening, type OpeningMap } from './lib/openings';
import { downloadFile, readLibrary, writeLibrary, type SavedStudy } from './lib/storage';
import { formatScore, type EngineLine } from './engine/controller';
import { useEngine } from './engine/useEngine';

const DRAFT = 'open-file:workspace:v1';
const SAMPLE =
  '[Event "Ruy Lopez exploration"]\n[White "Your notebook"]\n[Black "Open possibilities"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 {The Berlin Defense.}) 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O *';
function readDraft(): { study: Study; id: string | null; error: string } {
  try {
    const raw = localStorage.getItem(DRAFT);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        study: restoreStudy(data.study),
        id: typeof data.id === 'string' ? data.id : null,
        error: '',
      };
    }
  } catch {
    return {
      study: newStudy(),
      id: null,
      error: 'The previous workspace could not be restored. Saved notebooks have not been changed.',
    };
  }
  return { study: newStudy(), id: null, error: '' };
}
function pvMoves(fen: string, line: EngineLine) {
  const game = new Chess(fen);
  const output: { uci: string; san: string; label: string }[] = [];
  for (const uci of line.moves.slice(0, 12)) {
    try {
      const label = moveLabel(game.fen());
      const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      output.push({ uci, san: move.san, label });
    } catch {
      break;
    }
  }
  return output;
}
type Modal = 'import' | 'export' | 'editor' | 'library' | 'about' | 'new' | null;

export default function App() {
  const [initial] = useState(readDraft);
  const [study, setStudy] = useState(initial.study);
  const [savedId, setSavedId] = useState<string | null>(initial.id);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [modal, setModal] = useState<Modal>(null);
  const [enabled, setEnabled] = useState(true),
    [time, setTime] = useState(2500);
  const [showArrows, setShowArrows] = useState(true);
  const [openingIndex, setOpeningIndex] = useState<OpeningMap>({});
  const [openingError, setOpeningError] = useState(false);
  const [notice, setNotice] = useState(initial.error);
  const [draftError, setDraftError] = useState('');
  const [library, setLibrary] = useState<SavedStudy[]>([]);
  const [libraryError, setLibraryError] = useState('');
  const [importKind, setImportKind] = useState<'pgn' | 'fen' | 'json'>('pgn');
  const [importText, setImportText] = useState(''),
    [importError, setImportError] = useState('');
  const [exportKind, setExportKind] = useState<'pgn' | 'fen' | 'json'>('pgn');
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: Color } | null>(
    null,
  );
  const [boardVersion, setBoardVersion] = useState(0);
  const [renameId, setRenameId] = useState<string | null>(null),
    [renameTitle, setRenameTitle] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const game = useMemo(() => gameAt(study), [study]);
  const fen = game.fen(),
    node = study.nodes[study.cursor];
  const terminal = terminalReason(game);
  const position = useMemo(() => enginePosition(study), [study]);
  const engine = useEngine(
    position,
    game.turn(),
    enabled,
    time,
    !!terminal,
    Math.min(3, game.moves().length),
  );
  const opening = useMemo(() => findOpening(study, openingIndex), [study, openingIndex]);
  const path = useMemo(() => pathTo(study), [study]);
  const top = engine.lines[0];
  const arrows = useMemo(
    () => (showArrows ? engine.lines.map((line) => line.moves[0]).filter(Boolean) : []),
    [engine.lines, showArrows],
  );
  const whitePercent = top
    ? top.mate !== undefined
      ? top.mate >= 0
        ? 100
        : 0
      : Math.max(5, Math.min(95, 50 + 45 * Math.tanh((top.cp ?? 0) / 400)))
    : 50;
  const refreshLibrary = useCallback(() => {
    try {
      setLibrary(readLibrary());
      setLibraryError('');
    } catch (e) {
      setLibraryError((e as Error).message);
    }
  }, []);
  useEffect(refreshLibrary, [refreshLibrary]);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/openings.json`, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setOpeningIndex)
      .catch((e) => {
        if (e.name !== 'AbortError') setOpeningError(true);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    // Synchronous atomic write also covers closing immediately after a move.
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ study, id: savedId }));
      setDraftError('');
    } catch {
      setDraftError(
        'Browser storage is unavailable or full. Download a notebook backup to keep your work.',
      );
    }
  }, [study, savedId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  const navigate = useCallback((direction: 'first' | 'back' | 'next' | 'last') => {
    setStudy((prev) => {
      let id = prev.cursor;
      if (direction === 'first') id = 'root';
      if (direction === 'back') id = prev.nodes[id].parent ?? id;
      if (direction === 'next') id = prev.nodes[id].children[0] ?? id;
      if (direction === 'last') while (prev.nodes[id].children[0]) id = prev.nodes[id].children[0];
      return { ...prev, cursor: id };
    });
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        modal ||
        promotion ||
        target.closest('input, textarea, select, [contenteditable="true"]') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const direction = (
        { ArrowLeft: 'back', ArrowRight: 'next', Home: 'first', End: 'last' } as const
      )[event.key as 'ArrowLeft'];
      if (direction) {
        event.preventDefault();
        navigate(direction);
      }
      if (event.key.toLowerCase() === 'f')
        setOrientation((v) => (v === 'white' ? 'black' : 'white'));
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [modal, promotion, navigate]);
  function select(id: string) {
    setStudy((prev) => ({ ...prev, cursor: id }));
  }
  function play(from: string, to: string, piece?: string) {
    try {
      setStudy(addMove(study, { from, to, promotion: piece }));
    } catch (e) {
      setNotice((e as Error).message);
      setBoardVersion((v) => v + 1);
    }
    setPromotion(null);
  }
  function attemptMove(from: string, to: string) {
    const choices = game.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
    if (choices.some((m) => m.promotion)) {
      setPromotion({ from, to, color: game.turn() });
      setBoardVersion((v) => v + 1);
    } else play(from, to);
  }
  function playLine(line: EngineLine, through: number) {
    try {
      let next = study;
      for (const uci of line.moves.slice(0, through + 1))
        next = addMove(next, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      setStudy(next);
    } catch {
      setNotice('This line no longer matches the board. Wait for the current analysis.');
    }
  }
  function replace(next: Study, id: string | null = null) {
    setStudy(next);
    setSavedId(id);
    setModal(null);
    setImportError('');
    setPromotion(null);
  }
  function persist(next: SavedStudy[]) {
    try {
      if (libraryError)
        throw new Error(
          'Saved library could not be read. Export your current notebook before resolving browser storage.',
        );
      writeLibrary(next);
      setLibrary(next);
      return true;
    } catch (e) {
      setNotice(`Could not save: ${(e as Error).message}. Download a JSON backup.`);
      return false;
    }
  }
  function save() {
    const id = savedId ?? crypto.randomUUID();
    const entry = {
      id,
      savedAt: new Date().toISOString(),
      study: { ...study, title: study.title.trim() || 'Untitled analysis' },
    };
    const next = [entry, ...library.filter((item) => item.id !== id)];
    if (persist(next)) {
      setSavedId(id);
      setStudy(entry.study);
      setNotice('Notebook saved on this device.');
    }
  }
  function doImport() {
    try {
      const next =
        importKind === 'pgn'
          ? importPgn(importText)
          : importKind === 'fen'
            ? newStudy(importText.trim())
            : restoreStudy(JSON.parse(importText));
      replace(next);
      setNotice('Imported into your workspace.');
    } catch (e) {
      setImportError((e as Error).message);
    }
  }
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 1_000_000) {
      setImportError('Choose a file smaller than 1 MB.');
      return;
    }
    try {
      const text = await file.text();
      setImportKind(
        file.name.endsWith('.json') ? 'json' : file.name.endsWith('.fen') ? 'fen' : 'pgn',
      );
      setImportText(text);
      setImportError('');
    } catch {
      setImportError('This file could not be read.');
    }
  }
  const exportText =
    modal === 'export'
      ? exportKind === 'fen'
        ? fen
        : exportKind === 'json'
          ? JSON.stringify(study, null, 2)
          : exportPgn(study)
      : '';
  const exportName = `${study.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'analysis'}.${exportKind}`;
  const status = terminal
    ? 'Position complete'
    : {
        loading: 'Loading engine',
        analyzing: 'Analyzing',
        paused: 'Paused',
        ready: 'Ready',
        complete: 'Analysis complete',
        error: 'Engine unavailable',
      }[engine.status];

  return (
    <div className="app-shell">
      <aside className="rail">
        <a
          className="brand-mark"
          href="#"
          aria-label="Open File home"
          onClick={(e) => e.preventDefault()}
        >
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        </a>
        <div className="rail-divider" />
        <button
          className="rail-button active"
          title="Analysis workspace"
          aria-label="Analysis workspace"
          onClick={() => setModal(null)}
        >
          <Settings2 size={21} />
        </button>
        <button
          className="rail-button"
          title="My notebooks"
          aria-label="My notebooks"
          onClick={() => {
            refreshLibrary();
            setModal('library');
          }}
        >
          <NotebookPen size={21} />
        </button>
        <button
          className="rail-button"
          title="Position editor"
          aria-label="Position editor"
          onClick={() => setModal('editor')}
        >
          <Plus size={23} />
        </button>
        <div className="rail-bottom">
          <a
            className="rail-button"
            title="GitHub repository"
            aria-label="GitHub repository"
            href="https://github.com/gabeheem/chess-analysis"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={20} />
          </a>
          <button
            className="rail-button"
            title="About Open File"
            aria-label="About Open File"
            onClick={() => setModal('about')}
          >
            <Info size={20} />
          </button>
          <span className="avatar">GH</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-header">
          <div className="wordmark">
            open file<span className="wordmark-dot">.</span>
            <span className="header-separator" />
            <span className="header-caption">A LITTLE ROOM FOR CHESS</span>
          </div>
          <div className="header-right">
            <span className="local-badge">
              <span className="live-dot" />
              Local & private
            </span>
            <button
              className="secondary compact"
              onClick={() => {
                refreshLibrary();
                setModal('library');
              }}
            >
              <FolderOpen size={16} />
              My notebooks<span className="count-badge">{library.length}</span>
            </button>
          </div>
        </header>
        <main>
          <section className="workspace-heading">
            <div>
              <div className="eyebrow">THE ANALYSIS ROOM</div>
              <h1>
                Your next move<span>.</span>
              </h1>
              <p>A board, a few possibilities, and all the time you need.</p>
            </div>
            <div className="workspace-actions">
              <button className="secondary" onClick={() => setModal('import')}>
                <FileInput size={16} />
                Import game
              </button>
              <button className="primary" onClick={() => setModal('new')}>
                <Plus size={17} />
                New analysis
              </button>
            </div>
          </section>
          {draftError && (
            <div className="storage-warning" role="alert">
              {draftError}
              <button
                className="text-button"
                onClick={() => {
                  setExportKind('json');
                  setModal('export');
                }}
              >
                Download backup
              </button>
            </div>
          )}
          <div className="workspace-grid">
            <section className="board-column">
              <div className="board-meta">
                <span className="side-piece black-piece">●</span>
                <span>{orientation === 'white' ? 'Black' : 'White'}</span>
                <span className="side-label">
                  {(orientation === 'white' ? 'b' : 'w') === game.turn()
                    ? 'TO MOVE'
                    : 'ANALYSIS BOARD'}
                </span>
                <span className="board-format">Standard chess</span>
              </div>
              <div className="board-with-eval">
                <div
                  className={`eval-bar ${orientation === 'black' ? 'flipped' : ''}`}
                  role="img"
                  aria-label={`Evaluation ${formatScore(top)}, positive favors White. Scale is an advantage indicator, not a win probability.`}
                >
                  <div className="eval-white" style={{ height: `${whitePercent}%` }} />
                  <span className={whitePercent < 25 ? 'eval-text-light' : ''}>
                    {formatScore(top)}
                  </span>
                </div>
                <div className="board-frame">
                  <Board
                    key={boardVersion}
                    game={game}
                    orientation={orientation}
                    lastMove={node.uci}
                    arrows={arrows}
                    onMove={attemptMove}
                    disabled={!!promotion}
                  />
                </div>
              </div>
              <div className="board-meta bottom-meta">
                <span className="side-piece white-piece">●</span>
                <span>{orientation === 'white' ? 'White' : 'Black'}</span>
                <span className="side-label">
                  {(orientation === 'white' ? 'w' : 'b') === game.turn()
                    ? 'TO MOVE'
                    : 'ANALYSIS BOARD'}
                </span>
                <div className="board-tool-group">
                  <button
                    className="icon-button"
                    title="Flip board (F)"
                    aria-label="Flip board"
                    onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
                  >
                    <ArrowDownUp size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="Set up a position"
                    aria-label="Set up a position"
                    onClick={() => setModal('editor')}
                  >
                    <Settings2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="Export game or position"
                    aria-label="Export game or position"
                    onClick={() => setModal('export')}
                  >
                    <Download size={16} />
                  </button>
                </div>
              </div>
              <div className="board-controls">
                <span className="position-counter">
                  {path.length ? `Ply ${path.length}` : 'Starting position'}
                </span>
                <div className="navigation">
                  <button
                    className="icon-button"
                    aria-label="Go to starting position"
                    disabled={study.cursor === 'root'}
                    onClick={() => navigate('first')}
                  >
                    <ChevronFirst size={20} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Previous move"
                    disabled={study.cursor === 'root'}
                    onClick={() => navigate('back')}
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next move"
                    disabled={!node.children.length}
                    onClick={() => navigate('next')}
                  >
                    <ChevronRight size={22} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Last move in line"
                    disabled={!node.children.length}
                    onClick={() => navigate('last')}
                  >
                    <ChevronLast size={20} />
                  </button>
                </div>
                <button
                  className="text-button"
                  aria-label="Rewind to starting position"
                  onClick={() => select('root')}
                >
                  <RotateCcw size={13} />
                  <span>Rewind</span>
                </button>
              </div>
              <div className="board-hint">
                <Lightbulb size={15} />
                <span>
                  Follow a line. Change your mind. Every variation stays in your notebook.
                </span>
              </div>
            </section>
            <aside className="analysis-column">
              <section className="analysis-panel">
                <div className="engine-heading">
                  <div>
                    <span className="eyebrow">YOUR SECOND PAIR OF EYES</span>
                    <h2>Engine analysis</h2>
                  </div>
                  <button
                    className={`engine-toggle ${enabled ? 'on' : ''}`}
                    role="switch"
                    aria-label="Enable engine analysis"
                    aria-checked={enabled}
                    onClick={() => setEnabled((v) => !v)}
                  >
                    <span />
                  </button>
                </div>
                <div className="engine-subheading">
                  <span className="engine-name">
                    <span
                      className={`live-dot ${engine.status === 'error' ? 'bad' : !enabled ? 'dim' : ''}`}
                    />
                    Stockfish 19 <span className="lite-tag">LITE</span>
                  </span>
                  <select
                    aria-label="Analysis time per position"
                    value={time}
                    onChange={(e) => setTime(Number(e.target.value))}
                  >
                    <option value="1000">Quick · 1s</option>
                    <option value="2500">Balanced · 2.5s</option>
                    <option value="8000">Deeper · 8s</option>
                    <option value="20000">Explore · 20s</option>
                  </select>
                </div>
                <div className="engine-status" aria-live="polite">
                  {engine.status === 'analyzing' && !terminal ? (
                    <LoaderCircle className="spin" size={13} />
                  ) : enabled ? (
                    <Check size={13} />
                  ) : (
                    <Pause size={13} />
                  )}
                  <span>{status}</span>
                  <span className="depth">{top ? `DEPTH ${top.depth}` : 'ON YOUR DEVICE'}</span>
                </div>
                {engine.error && (
                  <div className="engine-error" role="alert">
                    <p>{engine.error}</p>
                    <button className="secondary compact" onClick={engine.retry}>
                      Retry engine
                    </button>
                  </div>
                )}
                {terminal && <div className="terminal-result">{terminal}</div>}
                <div className="candidate-lines">
                  {engine.lines.length ? (
                    engine.lines.map((line) => {
                      const moves = pvMoves(fen, line);
                      return (
                        <div
                          className={`candidate-line ${line.rank === 1 ? 'best' : ''}`}
                          key={line.rank}
                        >
                          <span className="candidate-rank">0{line.rank}</span>
                          <span className="candidate-score">{formatScore(line)}</span>
                          <div className="candidate-moves">
                            {moves.map((move, i) => (
                              <button
                                key={`${move.uci}-${i}`}
                                onClick={() => playLine(line, i)}
                                title={`Explore through ${move.label} ${move.san}`}
                              >
                                <span className="pv-number">
                                  {i === 0 || move.label.endsWith('.') ? move.label : ''}
                                </span>
                                {move.san}
                              </button>
                            ))}
                          </div>
                          <ArrowUpRight size={14} className="candidate-arrow" />
                        </div>
                      );
                    })
                  ) : (
                    <div className="engine-empty">
                      {terminal
                        ? 'Explore another position to continue.'
                        : !enabled
                          ? 'Your board, your pace. Turn the engine on when you want a second opinion.'
                          : engine.status === 'error'
                            ? 'Analysis will appear when the engine is available.'
                            : 'Looking at the possibilities…'}
                    </div>
                  )}
                </div>
                <div className="engine-footer">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={showArrows}
                      onChange={(e) => setShowArrows(e.target.checked)}
                    />
                    Best-move arrows
                  </label>
                  <span>+ favors White</span>
                </div>
                <div className="opening-card">
                  <div className="opening-icon">
                    <BookOpen size={19} />
                  </div>
                  <div>
                    <span className="eyebrow">
                      {opening ? `OPENING · ${opening.eco}` : 'OPENING EXPLORER'}
                    </span>
                    <h3>
                      {opening?.name ||
                        (openingError ? 'Opening data unavailable' : 'An open book')}
                    </h3>
                    <p>
                      {opening
                        ? 'Last recognized opening in this line'
                        : openingError
                          ? 'Reload to retry the local opening database.'
                          : Object.keys(openingIndex).length
                            ? 'Play a few moves to find your opening.'
                            : 'Loading local opening database…'}
                    </p>
                  </div>
                </div>
                <MoveTree study={study} select={select} />
              </section>
              <section className="notebook-panel">
                <div className="section-heading">
                  <h2>
                    <NotebookPen size={17} />
                    Your notebook
                  </h2>
                  <button className="text-button accent" onClick={save}>
                    <Save size={14} />
                    Save
                  </button>
                </div>
                <input
                  className="notebook-title"
                  aria-label="Notebook title"
                  value={study.title}
                  maxLength={160}
                  onChange={(e) => setStudy((prev) => ({ ...prev, title: e.target.value }))}
                />
                <textarea
                  className="notes-input"
                  aria-label="Notebook notes"
                  placeholder="What do you see? Leave a thought for later…"
                  value={study.notes}
                  onChange={(e) => setStudy((prev) => ({ ...prev, notes: e.target.value }))}
                />
                <div className="notebook-footer">
                  <span className="live-dot dim" />
                  {draftError
                    ? 'Workspace not saved'
                    : 'Workspace restored automatically on this device'}
                </div>
              </section>
            </aside>
          </div>
          <footer className="page-footer">
            <span>Made for the love of the game.</span>
            <span>
              <span className="keycap">←</span>
              <span className="keycap">→</span> navigate <span className="footer-dot">·</span>{' '}
              <span className="keycap">F</span> flip board
            </span>
            <button className="text-button" onClick={() => setModal('about')}>
              Open source. Open possibilities.
              <ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {promotion && (
        <Dialog
          title="Choose your promotion"
          onClose={() => {
            setPromotion(null);
            setBoardVersion((v) => v + 1);
          }}
        >
          <p className="muted">Promote the pawn on {promotion.to}.</p>
          <div className="promotion-options">
            {['q', 'r', 'b', 'n'].map((piece) => (
              <button
                className="secondary"
                aria-label={`Promote to ${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[piece as 'q']}`}
                key={piece}
                onClick={() => play(promotion.from, promotion.to, piece)}
              >
                <img
                  alt=""
                  src={`${import.meta.env.BASE_URL}pieces/${promotion.color}${piece.toUpperCase()}.svg`}
                />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {modal === 'new' && (
        <Dialog title="A fresh board" onClose={() => setModal(null)}>
          <p className="muted">
            Start a new notebook, or explore a classic Ruy Lopez line. Save or download your current
            notebook first if you want to keep it.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary"
              onClick={() => {
                save();
              }}
            >
              Save current
            </button>
            <button className="secondary" onClick={() => replace(importPgn(SAMPLE))}>
              Try a classic
            </button>
            <button className="primary" onClick={() => replace(newStudy())}>
              Start fresh
              <ArrowRight size={16} />
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'import' && (
        <Dialog title="Bring a game to the board" onClose={() => setModal(null)}>
          <p className="muted">
            Import one game, a position, or an Open File notebook backup. This replaces the
            workspace; save your current notebook first.
          </p>
          <div className="tabs">
            {(['pgn', 'fen', 'json'] as const).map((kind) => (
              <button
                className={importKind === kind ? 'active' : ''}
                onClick={() => {
                  setImportKind(kind);
                  setImportError('');
                }}
                key={kind}
              >
                {kind === 'json' ? 'Notebook JSON' : kind.toUpperCase()}
              </button>
            ))}
          </div>
          <label>
            {importKind === 'pgn'
              ? 'Game notation'
              : importKind === 'fen'
                ? 'Position notation'
                : 'Notebook backup'}
            <textarea
              className="notation-input"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={
                importKind === 'pgn'
                  ? '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6…'
                  : importKind === 'fen'
                    ? 'Paste a complete six-field FEN…'
                    : 'Paste your exported notebook JSON…'
              }
            />
          </label>
          <p className="tiny muted">
            PGN variations and brace/semicolon comments are preserved. Numeric and symbolic
            annotation glyphs are ignored. One standard-chess game per import; up to 1 MB.
          </p>
          {importError && (
            <p className="error" role="alert">
              {importError}
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".pgn,.fen,.json,.txt"
            hidden
            onChange={(e) => {
              void readFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="dialog-actions">
            <button className="secondary" onClick={() => fileInput.current?.click()}>
              <Upload size={16} />
              Choose file
            </button>
            <button className="primary" disabled={!importText.trim()} onClick={doImport}>
              Open on board
              <ArrowRight size={16} />
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'export' && (
        <Dialog title="Take your analysis with you" onClose={() => setModal(null)}>
          <p className="muted">
            PGN includes every variation and position comment. Choose notebook JSON to keep your
            title, notes, and current position too.
          </p>
          <div className="tabs">
            {(['pgn', 'fen', 'json'] as const).map((kind) => (
              <button
                className={exportKind === kind ? 'active' : ''}
                onClick={() => setExportKind(kind)}
                key={kind}
              >
                {kind === 'json' ? 'Notebook JSON' : kind.toUpperCase()}
              </button>
            ))}
          </div>
          <textarea
            aria-label="Exported notation"
            className="notation-input"
            readOnly
            value={exportText}
            onFocus={(e) => e.target.select()}
          />
          <div className="dialog-actions">
            <span className="muted tiny">Select the text to copy, or download a file.</span>
            <button
              className="primary"
              onClick={() =>
                downloadFile(
                  exportName,
                  exportText,
                  exportKind === 'json' ? 'application/json' : 'text/plain',
                )
              }
            >
              <Download size={16} />
              Download {exportKind.toUpperCase()}
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'editor' && (
        <Dialog title="Set up a position" wide onClose={() => setModal(null)}>
          <p className="muted">
            Create a position to explore. Applying it starts a new notebook; save your current work
            first.
          </p>
          <PositionEditor initialFen={fen} apply={(value) => replace(newStudy(value))} />
        </Dialog>
      )}
      {modal === 'library' && (
        <Dialog title="My notebooks" onClose={() => setModal(null)}>
          <p className="muted">
            Saved in this browser on this device. Clearing site data removes them. Download JSON
            backups for anything you want to keep.
          </p>
          {libraryError && (
            <p className="error" role="alert">
              {libraryError}
            </p>
          )}
          {!library.length && !libraryError && (
            <div className="library-empty">
              <NotebookPen size={34} />
              <h3>A place for your discoveries.</h3>
              <p>Save your first notebook from the analysis room.</p>
              <button className="primary" onClick={save}>
                <Save size={16} />
                Save current notebook
              </button>
            </div>
          )}
          <div className="library-list">
            {library.map((item) => (
              <div className="library-item" key={item.id}>
                {renameId === item.id ? (
                  <form
                    className="rename-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        persist(
                          library.map((entry) =>
                            entry.id === item.id
                              ? {
                                  ...entry,
                                  study: {
                                    ...entry.study,
                                    title: renameTitle.trim() || 'Untitled analysis',
                                  },
                                }
                              : entry,
                          ),
                        )
                      ) {
                        if (savedId === item.id)
                          setStudy((prev) => ({
                            ...prev,
                            title: renameTitle.trim() || 'Untitled analysis',
                          }));
                        setRenameId(null);
                      }
                    }}
                  >
                    <input
                      aria-label="Rename notebook"
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      autoFocus
                      maxLength={160}
                    />
                    <button className="icon-button" aria-label="Confirm notebook name">
                      <Check size={17} />
                    </button>
                  </form>
                ) : (
                  <button className="library-open" onClick={() => replace(item.study, item.id)}>
                    <strong>{item.study.title}</strong>
                    <span>
                      {new Date(item.savedAt).toLocaleDateString()} ·{' '}
                      {Object.keys(item.study.nodes).length - 1} moves
                    </span>
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Rename ${item.study.title}`}
                  onClick={() => {
                    setRenameId(item.id);
                    setRenameTitle(item.study.title);
                  }}
                >
                  <NotebookPen size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Download ${item.study.title}`}
                  onClick={() =>
                    downloadFile(
                      `${item.study.title.replace(/[^a-z0-9]/gi, '-')}.json`,
                      JSON.stringify(item.study, null, 2),
                      'application/json',
                    )
                  }
                >
                  <Download size={16} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Delete ${item.study.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete “${item.study.title}” from this browser?`)) {
                      if (
                        persist(library.filter((entry) => entry.id !== item.id)) &&
                        savedId === item.id
                      )
                        setSavedId(null);
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <p className="tiny muted">
            Opening a notebook replaces the current workspace. Save current changes first.
          </p>
        </Dialog>
      )}
      {modal === 'about' && (
        <Dialog title="Open File" onClose={() => setModal(null)}>
          <p>
            A little room for chess. Explore your own ideas with Stockfish 19 Lite, a local opening
            book, and a notebook that stays on your device.
          </p>
          <p className="muted">
            Analysis runs in a single-threaded WebAssembly worker. The Lite engine uses a smaller
            network than full Stockfish. Evaluations depend on search time and are not guarantees.
            The evaluation bar indicates advantage, not your personal win probability.
          </p>
          <p className="muted">
            No account, paid API, analytics, or runtime CDN. Run the app locally for offline use;
            this version does not install an offline service worker.
          </p>
          <div className="about-links">
            <a href="https://github.com/gabeheem/chess-analysis" target="_blank" rel="noreferrer">
              Source & setup
              <ArrowUpRight size={14} />
            </a>
            <a
              href={`${import.meta.env.BASE_URL}licenses/NOTICE.txt`}
              target="_blank"
              rel="noreferrer"
            >
              Credits & licenses
              <ArrowUpRight size={14} />
            </a>
          </div>
          <p className="tiny muted">
            Built with React, chess.js, Chessground, Stockfish.js, Lucide, Lichess opening data, and
            Cburnett pieces. Free software under GPL-3.0-or-later.
          </p>
        </Dialog>
      )}
    </div>
  );
}
