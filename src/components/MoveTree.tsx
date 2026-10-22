import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { pathTo, moveLabel, type Study, type MoveNode } from '../lib/study';
export default function MoveTree({
  study,
  select,
}: {
  study: Study;
  select: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(true);
  const active = new Set(pathTo(study).map((n) => n.id));
  // A flat traversal keeps every imported branch accessible without deeply
  // nested React elements. Indentation is capped; the move data is not.
  const rows: { depth: number; moves: MoveNode[] }[] = [];
  const pending = study.nodes.root.children[0]
    ? [{ id: study.nodes.root.children[0], depth: 0 }]
    : [];
  while (pending.length) {
    const task = pending.pop()!;
    let id: string | undefined = task.id;
    let moves: MoveNode[] = [];
    while (id) {
      const node: MoveNode = study.nodes[id];
      const parent = study.nodes[node.parent!];
      moves.push(node);
      const variants = showAll && parent.children[0] === id ? parent.children.slice(1) : [];
      if (variants.length) {
        rows.push({ depth: task.depth, moves });
        moves = [];
        if (node.children[0]) pending.push({ id: node.children[0], depth: task.depth });
        for (const variant of variants.reverse())
          pending.push({ id: variant, depth: task.depth + 1 });
        break;
      }
      id = node.children[0];
    }
    if (moves.length) rows.push({ depth: task.depth, moves });
  }
  function renderMove(node: MoveNode) {
    return (
      <span className="move-unit" key={node.id}>
        <span className="move-number">{moveLabel(study.nodes[node.parent!].fen)}</span>
        <button
          className={`move ${active.has(node.id) ? 'on-path' : ''} ${study.cursor === node.id ? 'selected' : ''}`}
          onClick={() => select(node.id)}
          title={node.comment || node.uci}
        >
          {node.san}
          {node.comment && <span className="comment-dot"> •</span>}
        </button>
      </span>
    );
  }
  return (
    <section className="history-section">
      <div className="section-heading">
        <h2>Move history</h2>
        <button className="text-button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Variations
        </button>
      </div>
      <div className="move-tree" data-testid="move-tree">
        {study.nodes.root.children.length ? (
          rows.map((row) => (
            <div
              key={row.moves[0].id}
              className={row.depth ? 'variation-row' : 'main-row'}
              style={{ paddingLeft: Math.min(row.depth, 8) * 10 }}
            >
              {row.depth > 0 && <span className="variation-symbol">↳ </span>}
              {row.moves.map(renderMove)}
            </div>
          ))
        ) : (
          <div className="history-empty">
            <span>Every move starts a possibility.</span>
            <p>Make a move on the board, or import a game to explore.</p>
          </div>
        )}
      </div>
      <button
        className={`root-button ${study.cursor === 'root' ? 'current' : ''}`}
        onClick={() => select('root')}
      >
        Starting position
      </button>
    </section>
  );
}
