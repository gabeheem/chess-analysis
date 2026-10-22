import { useEffect } from 'react';
import { Chess } from 'chess.js';
import { useEngine } from '../engine/useEngine';
import { formatScore } from '../engine/controller';
import { enginePosition, gameAt, moveLabel, type Study } from '../lib/study';

// Mounted only when the player explicitly asks for help. This worker never
// supplies the opponent's moves or changes its strength-limited controller.
export default function PlayAnalysis({
  study,
  onArrows,
}: {
  study: Study;
  onArrows: (arrows: string[]) => void;
}) {
  const game = gameAt(study);
  const analysis = useEngine(
    enginePosition(study),
    game.turn(),
    true,
    1500,
    game.isCheckmate() || game.isStalemate() || game.isInsufficientMaterial(),
    Math.min(3, game.moves().length),
  );
  const arrows = analysis.lines
    .map((line) => line.moves[0])
    .filter(Boolean)
    .join(' ');
  useEffect(() => {
    onArrows(arrows ? arrows.split(' ') : []);
    return () => onArrows([]);
  }, [arrows, onArrows]);
  return (
    <section className="analysis-panel play-analysis" aria-label="Live analysis">
      <div className="section-heading">
        <h2>Live analysis</h2>
        <strong className="live-evaluation">{formatScore(analysis.lines[0])}</strong>
      </div>
      <p className="tiny muted">
        Full strength · + favors White. Your opponent keeps its selected Elo.
      </p>
      {analysis.lines.map((line) => {
        const position = new Chess(game.fen());
        const moves: string[] = [];
        for (const uci of line.moves.slice(0, 10)) {
          try {
            const label = moveLabel(position.fen());
            const move = position.move({
              from: uci.slice(0, 2),
              to: uci.slice(2, 4),
              promotion: uci[4],
            });
            moves.push(`${label} ${move.san}`);
          } catch {
            break;
          }
        }
        return (
          <div className="play-candidate" key={line.rank}>
            <strong>{formatScore(line)}</strong>
            <span>{moves.join(' ')}</span>
            <small>Depth {line.depth}</small>
          </div>
        );
      })}
      {!analysis.lines.length && !analysis.error && (
        <p className="small muted" role="status">
          {analysis.status === 'paused'
            ? 'No continuations in this position.'
            : 'Analyzing this position…'}
        </p>
      )}
      {analysis.error && (
        <div role="alert">
          <p className="small">{analysis.error}</p>
          <button className="secondary compact" onClick={analysis.retry}>
            Retry analysis
          </button>
        </div>
      )}
    </section>
  );
}
