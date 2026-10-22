import { useState } from 'react';
import { Chess, DEFAULT_POSITION, type Square } from 'chess.js';
import { Eraser, RotateCcw } from 'lucide-react';
import { assertPosition } from '../lib/study';

const roles = ['K', 'Q', 'R', 'B', 'N', 'P'];
function placements(fen: string): Record<string, string> {
  const board: Record<string, string> = {};
  let rank = 8,
    file = 0;
  for (const token of fen.split(' ')[0]) {
    if (token === '/') {
      rank--;
      file = 0;
    } else if (/\d/.test(token)) file += Number(token);
    else {
      board[String.fromCharCode(97 + file) + rank] = token;
      file++;
    }
  }
  return board;
}
export default function PositionEditor({
  initialFen,
  apply,
}: {
  initialFen: string;
  apply: (fen: string) => void;
}) {
  const [board, setBoard] = useState(() => placements(initialFen));
  const [tool, setTool] = useState('P');
  const [turn, setTurn] = useState(initialFen.split(' ')[1]);
  const [rights, setRights] = useState(initialFen.split(' ')[2].replace('-', ''));
  const [ep, setEp] = useState(initialFen.split(' ')[3]);
  const [half, setHalf] = useState(initialFen.split(' ')[4]);
  const [full, setFull] = useState(initialFen.split(' ')[5]);
  const [error, setError] = useState('');
  function fen() {
    const ranks = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = '',
        empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = board[String.fromCharCode(97 + file) + rank];
        if (!piece) empty++;
        else {
          if (empty) row += empty;
          empty = 0;
          row += piece;
        }
      }
      if (empty) row += empty;
      ranks.push(row);
    }
    return `${ranks.join('/')} ${turn} ${
      'KQkq'
        .split('')
        .filter((r) => rights.includes(r))
        .join('') || '-'
    } ${ep || '-'} ${half || '0'} ${full || '1'}`;
  }
  const symbols: Record<string, string> = {
    k: 'king',
    q: 'queen',
    r: 'rook',
    b: 'bishop',
    n: 'knight',
    p: 'pawn',
  };
  return (
    <div className="editor-layout">
      <div>
        <div className="editor-board">
          {Array.from({ length: 64 }, (_, i) => {
            const square = String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8));
            const piece = board[square];
            return (
              <button
                key={square}
                aria-label={`${square}${piece ? ` ${piece === piece.toUpperCase() ? 'White' : 'Black'} ${symbols[piece.toLowerCase()]}` : ' empty'}`}
                className={(Math.floor(i / 8) + (i % 8)) % 2 ? 'dark-square' : 'light-square'}
                onClick={() => {
                  setError('');
                  setBoard((prev) => {
                    const next = { ...prev };
                    if (tool) next[square] = tool;
                    else delete next[square];
                    return next;
                  });
                }}
                draggable={!!piece}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', square)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const source = e.dataTransfer.getData('text/plain') as Square;
                  if (!board[source]) return;
                  setBoard((prev) => {
                    const next = { ...prev, [square]: prev[source] };
                    if (source !== square) delete next[source];
                    return next;
                  });
                }}
              >
                {piece && (
                  <img
                    draggable={false}
                    alt=""
                    src={`${import.meta.env.BASE_URL}pieces/${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}.svg`}
                  />
                )}
                <span>{square}</span>
              </button>
            );
          })}
        </div>
        <div className="editor-actions">
          <button
            className="text-button"
            onClick={() => {
              setBoard({});
              setRights('');
              setEp('-');
            }}
          >
            <Eraser size={15} />
            Clear board
          </button>
          <button
            className="text-button"
            onClick={() => {
              setBoard(placements(DEFAULT_POSITION));
              setTurn('w');
              setRights('KQkq');
              setEp('-');
              setHalf('0');
              setFull('1');
            }}
          >
            <RotateCcw size={15} />
            Initial setup
          </button>
        </div>
      </div>
      <div className="editor-options">
        <p className="muted small">
          Choose a piece, then click a square. Drag existing pieces to rearrange them.
        </p>
        <div className="piece-palette">
          {['w', 'b'].map((color) => (
            <div key={color}>
              {roles.map((role) => {
                const value = color === 'w' ? role : role.toLowerCase();
                return (
                  <button
                    key={role}
                    className={tool === value ? 'chosen' : ''}
                    aria-label={`Place ${color === 'w' ? 'White' : 'Black'} ${symbols[role.toLowerCase()]}`}
                    onClick={() => setTool(value)}
                  >
                    <img alt="" src={`${import.meta.env.BASE_URL}pieces/${color}${role}.svg`} />
                  </button>
                );
              })}
            </div>
          ))}
          <button
            className={`secondary erase-tool ${tool === '' ? 'chosen' : ''}`}
            onClick={() => setTool('')}
          >
            <Eraser size={16} />
            Eraser
          </button>
        </div>
        <label>
          Side to move
          <select value={turn} onChange={(e) => setTurn(e.target.value)}>
            <option value="w">White</option>
            <option value="b">Black</option>
          </select>
        </label>
        <fieldset>
          <legend>Castling rights</legend>
          {['K', 'Q', 'k', 'q'].map((right) => (
            <label className="checkbox" key={right}>
              <input
                type="checkbox"
                checked={rights.includes(right)}
                onChange={(e) =>
                  setRights(e.target.checked ? rights + right : rights.replace(right, ''))
                }
              />
              {
                {
                  K: 'White kingside',
                  Q: 'White queenside',
                  k: 'Black kingside',
                  q: 'Black queenside',
                }[right as 'K']
              }
            </label>
          ))}
        </fieldset>
        <label>
          En passant target
          <select value={ep} onChange={(e) => setEp(e.target.value)}>
            <option value="-">None</option>
            {['3', '6'].flatMap((rank) =>
              'abcdefgh'.split('').map((file) => <option key={file + rank}>{file + rank}</option>),
            )}
          </select>
        </label>
        <div className="field-row">
          <label>
            Halfmove clock
            <input type="number" min="0" value={half} onChange={(e) => setHalf(e.target.value)} />
          </label>
          <label>
            Move number
            <input type="number" min="1" value={full} onChange={(e) => setFull(e.target.value)} />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          className="primary"
          onClick={() => {
            try {
              const value = fen();
              assertPosition(value);
              const game = new Chess(value);
              apply(game.fen());
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Analyze this position
        </button>
        <p className="muted tiny">
          Static legality is checked; historical reachability is not proven. Opens a new notebook.
        </p>
      </div>
    </div>
  );
}
