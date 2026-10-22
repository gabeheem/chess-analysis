import { useEffect, useMemo, useState } from 'react';
import { type Color } from 'chess.js';
import {
  ArrowLeft,
  ArrowRight,
  ArrowDownUp,
  BookOpen,
  Check,
  Download,
  Flag,
  LoaderCircle,
  Play,
  RotateCcw,
  Save,
  Swords,
} from 'lucide-react';
import Board from './Board';
import Dialog from './Dialog';
import PlayAnalysis from './PlayAnalysis';
import { usePlayEngine } from '../engine/usePlayEngine';
import { useBoardFit } from '../lib/useBoardFit';
import { gameAt, newStudy, pathTo, moveLabel, type Study } from '../lib/study';
import { findOpening, type OpeningMap } from '../lib/openings';
import { exportPgn } from '../lib/pgn';
import { downloadFile } from '../lib/storage';
import {
  type EngineGame,
  canHumanMove,
  chooseSide,
  claimDraw,
  claimableDraw,
  createEngineGame,
  engineMove,
  gameRequestId,
  humanMove,
  resignGame,
  sideName,
} from '../lib/engineGame';

type Props = {
  openings: OpeningMap;
  onExit: () => void;
  onAnalyze: (study: Study) => void;
  onSave: (study: Study, gameId: string) => boolean;
};
export default function PlayVsEngine({ openings, onExit, onAnalyze, onSave }: Props) {
  const [session, setSession] = useState<EngineGame | null>(null);
  const [elo, setElo] = useState(1500);
  const [side, setSide] = useState<Color | 'random'>('w');
  const [time, setTime] = useState(1500);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<'restart' | 'leave' | 'resign' | 'claim' | null>(null);
  const [intended, setIntended] = useState('');
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [boardVersion, setBoardVersion] = useState(0);
  const [savedSession, setSavedSession] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [hintArrows, setHintArrows] = useState<string[]>([]);
  const engine = usePlayEngine(session);
  const range = engine.eloRange;
  const boardColumn = useBoardFit();
  const setupStudy = useMemo(() => newStudy(), []);
  const study = session?.study ?? setupStudy;
  const game = useMemo(() => gameAt(study), [study]);
  const opening = useMemo(() => findOpening(study, openings), [study, openings]);
  const canMove = !!session && canHumanMove(session);
  const engineTurn = !!session && !session.outcome && !canMove;
  const orientation =
    (session?.human ?? (side === 'random' ? 'w' : side)) === 'w' ? 'white' : 'black';
  const moves = useMemo(() => pathTo(study), [study]);
  const claim = canMove ? claimableDraw(game) : null;
  const eloChoices = useMemo(
    () =>
      range
        ? [
            ...new Set([
              range.min,
              ...Array.from(
                {
                  length: Math.max(0, Math.floor(range.max / 100) - Math.ceil(range.min / 100) + 1),
                },
                (_, i) => (Math.ceil(range.min / 100) + i) * 100,
              ),
              range.max,
            ]),
          ].sort((a, b) => a - b)
        : [],
    [range],
  );
  useEffect(() => {
    if (range && (elo < range.min || elo > range.max)) setElo(range.min);
  }, [range, elo]);
  useEffect(() => {
    if (
      !session ||
      engine.status !== 'complete' ||
      !engine.bestMove ||
      engine.requestId !== gameRequestId(session) ||
      session.outcome
    )
      return;
    try {
      const next = engineMove(session, engine.bestMove, engine.requestId);
      setSession((current) =>
        current && gameRequestId(current) === engine.requestId ? next : current,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session, engine.status, engine.bestMove, engine.requestId]);
  function start() {
    if (!range || elo < range.min || elo > range.max) {
      setError('Choose a supported opponent rating.');
      return;
    }
    setSession(createEngineGame(chooseSide(side), elo, time));
    setError('');
    setNotice('');
    setSavedSession(null);
    setPromotion(null);
    setShowAnalysis(false);
    setHintArrows([]);
  }
  function move(from: string, to: string, piece?: string) {
    if (!session || !canHumanMove(session)) {
      setBoardVersion((v) => v + 1);
      return;
    }
    try {
      setSession(humanMove(session, { from, to, promotion: piece }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
      setBoardVersion((v) => v + 1);
    }
    setPromotion(null);
  }
  function attemptMove(from: string, to: string) {
    if (!canMove) {
      setBoardVersion((v) => v + 1);
      return;
    }
    if (game.moves({ verbose: true }).some((m) => m.from === from && m.to === to && m.promotion)) {
      setPromotion({ from, to });
      setBoardVersion((v) => v + 1);
    } else move(from, to);
  }
  function reset() {
    setSession(null);
    setDialog(null);
    setPromotion(null);
    setError('');
    setNotice('');
    setSavedSession(null);
    setShowAnalysis(false);
    setHintArrows([]);
  }
  function saveGame() {
    if (session) {
      if (onSave(session.study, session.id)) {
        setSavedSession(session.id);
        setNotice('Game saved in My notebooks. Save again to update it after more moves.');
      } else setError('The game could not be saved. Export its PGN to keep a backup.');
    }
  }
  const playerText = (color: Color) =>
    session
      ? color === session.human
        ? `You · ${sideName(color)}`
        : `Stockfish · ~${session.elo} Elo`
      : `${sideName(color)} pieces`;
  const upperColor = orientation === 'white' ? 'b' : 'w';
  const lowerColor = orientation === 'white' ? 'w' : 'b';
  const status = !session
    ? 'Choose your opponent'
    : session.outcome
      ? session.outcome.reason
      : engine.status === 'error' || error
        ? 'Engine needs attention'
        : engineTurn
          ? engine.status === 'loading'
            ? 'Loading Stockfish…'
            : 'Stockfish is thinking…'
          : game.isCheck()
            ? 'Your king is in check'
            : 'Your move';

  return (
    <div className="app-shell play-mode">
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
          className="rail-button"
          aria-label="Return to analysis"
          onClick={() => (session && !session.outcome ? setDialog('leave') : onExit())}
        >
          <ArrowLeft size={21} />
        </button>
        <span className="rail-button active">
          <Swords size={21} />
        </span>
      </aside>
      <div className="main-shell">
        <header className="app-header">
          <div className="wordmark">
            open file<span className="wordmark-dot">.</span>
            <span className="play-header-label">PLAY VS ENGINE</span>
          </div>
          <button
            className="secondary compact"
            onClick={() => (session && !session.outcome ? setDialog('leave') : onExit())}
          >
            <ArrowLeft size={15} />
            Analysis
          </button>
        </header>
        <main>
          <div className="workspace-grid play-grid">
            <section className="board-column" ref={boardColumn}>
              <div className="board-opening" aria-live="polite">
                <div className="board-opening-label">
                  <BookOpen size={15} />
                  <span>OPENING</span>
                  {opening && <span className="opening-code">{opening.eco}</span>}
                </div>
                <h1>{opening?.name ?? 'A new game'}</h1>
              </div>
              <div className="board-meta">
                <span
                  className={`side-piece ${upperColor === 'b' ? 'black-piece' : 'white-piece'}`}
                >
                  ●
                </span>
                <span>{playerText(upperColor)}</span>
                {session && !session.outcome && game.turn() === upperColor && (
                  <span className="side-label">TO MOVE</span>
                )}
                <span className="board-format">Unrated · no clock</span>
              </div>
              <div className="board-with-eval">
                <div className="board-frame">
                  <Board
                    key={boardVersion}
                    game={game}
                    orientation={orientation}
                    lastMove={study.nodes[study.cursor].uci}
                    arrows={showAnalysis ? hintArrows : []}
                    onMove={attemptMove}
                    disabled={!canMove || !!promotion}
                  />
                </div>
              </div>
              <div className="board-meta bottom-meta">
                <span
                  className={`side-piece ${lowerColor === 'b' ? 'black-piece' : 'white-piece'}`}
                >
                  ●
                </span>
                <span>{playerText(lowerColor)}</span>
                {session && !session.outcome && game.turn() === lowerColor && (
                  <span className="side-label">TO MOVE</span>
                )}
                <span className="board-format">
                  {moves.length ? `Ply ${moves.length}` : 'Starting position'}
                </span>
              </div>
            </section>
            <aside className="analysis-column play-sidebar">
              <section className="analysis-panel game-panel">
                <div className="engine-heading">
                  <div className="game-panel-title">
                    <Swords size={20} />
                    <h2>Play vs Engine</h2>
                  </div>
                  <span className="lite-tag">LOCAL</span>
                </div>
                {!session ? (
                  <div className="game-setup">
                    <p className="muted small">Pick an opponent and take a seat.</p>
                    <label>
                      Approximate opponent Elo
                      <select
                        aria-label="Opponent Elo"
                        value={range ? elo : ''}
                        disabled={!range}
                        onChange={(e) => setElo(Number(e.target.value))}
                      >
                        {!range && <option value="">Loading supported range…</option>}
                        {eloChoices.map((value) => (
                          <option key={value} value={value}>
                            ~{value} Elo
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="tiny muted range-note">
                      {range
                        ? `Engine-reported range: ${range.min}–${range.max}.`
                        : 'Reading the bundled engine’s supported rating range.'}{' '}
                      Ratings are estimates; hardware and thinking time affect actual strength.
                    </p>
                    <fieldset className="side-choice">
                      <legend>Your side</legend>
                      <div role="radiogroup" aria-label="Your side">
                        {(['w', 'b', 'random'] as const).map((choice) => (
                          <button
                            role="radio"
                            aria-checked={side === choice}
                            className={side === choice ? 'chosen' : ''}
                            onClick={() => setSide(choice)}
                            key={choice}
                          >
                            {choice === 'random' ? 'Random' : sideName(choice)}
                          </button>
                        ))}
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setSide((s) => (s === 'w' ? 'b' : 'w'))}
                      >
                        <ArrowDownUp size={14} />
                        Switch sides
                      </button>
                    </fieldset>
                    <label>
                      Thinking time per move
                      <select
                        aria-label="Engine thinking time"
                        value={time}
                        onChange={(e) => setTime(Number(e.target.value))}
                      >
                        <option value={500}>Quick · 0.5s</option>
                        <option value={1500}>Standard · 1.5s</option>
                        <option value={3000}>Deliberate · 3s</option>
                      </select>
                    </label>
                    <button
                      className="primary start-game"
                      disabled={!range || engine.status === 'error'}
                      onClick={start}
                    >
                      <Play size={16} />
                      Start game
                    </button>
                    <p className="tiny muted">
                      Analysis is off by default; you can turn it on during play. Your workspace
                      stays intact. Games have no chess clock.
                    </p>
                  </div>
                ) : (
                  <div className="game-progress">
                    <div className="opponent-summary">
                      <span>STOCKFISH 19 LITE</span>
                      <strong>~{session.elo} Elo</strong>
                      <small>
                        You play {sideName(session.human)} · {session.time / 1000}s per engine move
                      </small>
                    </div>
                    <div
                      className={`game-status ${session.outcome ? 'finished' : ''}`}
                      role="status"
                    >
                      {engineTurn && !session.outcome && engine.status !== 'error' && !error ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : session.outcome ? (
                        <Check size={17} />
                      ) : (
                        <span className="live-dot" />
                      )}
                      <span>{status}</span>
                    </div>
                    {session.outcome && (
                      <div className="game-result">
                        <strong>{session.outcome.result}</strong>
                        <button className="primary" onClick={() => onAnalyze(session.study)}>
                          Analyze this game
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    )}
                    {!session.outcome && (
                      <>
                        <p className="small muted">
                          {engineTurn
                            ? 'Your pieces are locked while Stockfish chooses a move.'
                            : `Move a ${sideName(session.human).toLowerCase()} piece. ${showAnalysis ? 'Analysis is on.' : 'Engine hints are hidden.'}`}
                        </p>
                        {claim && (
                          <div className="draw-claim">
                            <p>
                              A draw can be claimed by {claim}. This does not end the game
                              automatically.
                            </p>
                            <button
                              className="secondary compact"
                              onClick={() => {
                                try {
                                  setSession(claimDraw(session));
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              Claim draw
                            </button>
                          </div>
                        )}
                        <div className="game-actions">
                          <button className="secondary" onClick={() => setDialog('resign')}>
                            <Flag size={15} />
                            Resign
                          </button>
                          <button className="secondary" onClick={() => setDialog('restart')}>
                            <RotateCcw size={15} />
                            Restart
                          </button>
                        </div>
                        {canMove && (
                          <button
                            className="text-button intended-claim"
                            onClick={() => {
                              setIntended('');
                              setError('');
                              setDialog('claim');
                            }}
                          >
                            Claim a draw with an intended move
                          </button>
                        )}
                      </>
                    )}
                    {session.outcome && (
                      <button className="secondary start-game" onClick={reset}>
                        <RotateCcw size={16} />
                        New game
                      </button>
                    )}
                    <label className="play-analysis-toggle">
                      <input
                        type="checkbox"
                        checked={showAnalysis}
                        onChange={(e) => setShowAnalysis(e.target.checked)}
                      />
                      Show analysis
                    </label>
                    <div className="game-actions export-game">
                      <button
                        className="text-button"
                        onClick={() =>
                          downloadFile(`stockfish-${session.elo}.pgn`, exportPgn(session.study))
                        }
                      >
                        <Download size={15} />
                        Export PGN
                      </button>
                      <button className="text-button" onClick={saveGame}>
                        <Save size={15} />
                        {savedSession === session.id ? 'Update saved game' : 'Save to notebook'}
                      </button>
                    </div>
                  </div>
                )}
                {(engine.error || error) && (
                  <div className="engine-error" role="alert">
                    <p>{error || engine.error}</p>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setError('');
                        engine.retry();
                      }}
                    >
                      Retry engine
                    </button>
                  </div>
                )}
                {notice && (
                  <p className="game-notice" role="status">
                    {notice}
                  </p>
                )}
              </section>
              {session && showAnalysis && (
                <PlayAnalysis study={session.study} onArrows={setHintArrows} />
              )}
              <section className="analysis-panel game-history">
                <div className="section-heading">
                  <h2>Move history</h2>
                  <span className="tiny muted">{moves.length} plies</span>
                </div>
                <div className="move-tree" data-testid="game-moves">
                  {moves.length ? (
                    moves.map((move) => (
                      <span className="move-unit" key={move.id}>
                        <span className="move-number">
                          {moveLabel(study.nodes[move.parent!].fen)}
                        </span>
                        <span className={`played-move ${move.id === study.cursor ? 'latest' : ''}`}>
                          {move.san}
                        </span>
                      </span>
                    ))
                  ) : (
                    <p className="muted small">
                      {session
                        ? session.human === 'b'
                          ? 'Stockfish makes the first move.'
                          : 'White moves first. The board is yours.'
                        : 'Your game will appear here.'}
                    </p>
                  )}
                </div>
              </section>
            </aside>
          </div>
        </main>
      </div>
      {promotion && (
        <Dialog
          title="Choose your promotion"
          onClose={() => {
            setPromotion(null);
            setBoardVersion((v) => v + 1);
          }}
        >
          <div className="promotion-options">
            {['q', 'r', 'b', 'n'].map((piece) => (
              <button
                className="secondary"
                key={piece}
                aria-label={`Promote to ${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[piece as 'q']}`}
                onClick={() => move(promotion.from, promotion.to, piece)}
              >
                <img
                  alt=""
                  src={`${import.meta.env.BASE_URL}pieces/${session!.human}${piece.toUpperCase()}.svg`}
                />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog === 'resign' && (
        <Dialog title="Resign this game?" onClose={() => setDialog(null)}>
          <p className="muted">
            The result will be recorded, and you can analyze or save the complete game.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Keep playing
            </button>
            <button
              className="primary"
              onClick={() => {
                setSession((current) => (current ? resignGame(current) : null));
                setDialog(null);
              }}
            >
              Resign game
            </button>
          </div>
        </Dialog>
      )}
      {(dialog === 'restart' || dialog === 'leave') && (
        <Dialog
          title={dialog === 'restart' ? 'Start over?' : 'Return to analysis?'}
          onClose={() => setDialog(null)}
        >
          <p className="muted">
            This game is still in progress. Save it to your notebook or export its PGN first if you
            want to keep it. Pending engine moves will be cancelled.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={saveGame}>
              <Save size={15} />
              Save game
            </button>
            <button className="primary" onClick={() => (dialog === 'restart' ? reset() : onExit())}>
              {dialog === 'restart' ? 'Choose a new game' : 'Leave game'}
            </button>
          </div>
        </Dialog>
      )}
      {dialog === 'claim' && (
        <Dialog title="Claim a draw with an intended move" onClose={() => setDialog(null)}>
          <p className="muted">
            Enter the legal move you intend to play, such as Nf3. A claim is accepted only if that
            move would create threefold repetition or complete fifty moves without a pawn move or
            capture. An accepted claim ends the game before that move is played.
          </p>
          <label>
            Intended move
            <input
              aria-label="Intended move"
              value={intended}
              onChange={(e) => setIntended(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!intended.trim()}
              onClick={() => {
                try {
                  setSession(claimDraw(session!, intended.trim()));
                  setError('');
                  setDialog(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Claim draw
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
