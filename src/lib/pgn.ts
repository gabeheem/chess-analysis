import { DEFAULT_POSITION } from 'chess.js';
import { addMove, newStudy, moveLabel, type Study, type MoveNode } from './study';

export function importPgn(input: string): Study {
  if (input.length > 1_000_000) throw new Error('Please import a single game smaller than 1 MB.');
  const headers: Record<string, string> = {};
  const body = input.replace(
    /\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\s*\]/g,
    (_, key: string, val: string) => {
      if (key in headers)
        throw new Error('Import one game at a time; duplicate PGN headers were found.');
      headers[key] = val.replace(/\\(["\\])/g, '$1');
      return ' ';
    },
  );
  let study = newStudy(headers.FEN ?? DEFAULT_POSITION);
  study.headers = headers;
  study.title =
    headers.White && headers.Black
      ? `${headers.White} – ${headers.Black}`
      : headers.Event || 'Imported game';
  const tokens = body.match(/\{[^}]*\}|;[^\r\n]*|\(|\)|[^\s(){};]+/g) ?? [];
  if (body.replace(/\{[^}]*\}|;[^\r\n]*|[^{}]/g, '').length)
    throw new Error('Unclosed PGN comment.');
  const stack: string[] = [];
  let lastMain = 'root';
  let ended = false;
  for (const raw of tokens) {
    if (raw.startsWith('{') || raw.startsWith(';')) {
      const node = study.nodes[study.cursor];
      const comment = raw.startsWith('{') ? raw.slice(1, -1) : raw.slice(1);
      study = {
        ...study,
        nodes: {
          ...study.nodes,
          [node.id]: {
            ...node,
            comment: [node.comment, comment.trim()].filter(Boolean).join('\n'),
          },
        },
      };
      continue;
    }
    if (raw === '(') {
      if (stack.length >= 64) throw new Error('PGN variation nesting exceeds 64 levels.');
      const parent = study.nodes[study.cursor].parent;
      if (!parent) throw new Error('A variation must follow a move.');
      stack.push(study.cursor);
      study = { ...study, cursor: parent };
      continue;
    }
    if (raw === ')') {
      const cursor = stack.pop();
      if (!cursor) throw new Error('Unexpected closing variation.');
      study = { ...study, cursor };
      continue;
    }
    const token = raw
      .replace(/^\d+\.(?:\.\.)?/, '')
      .replace(/\$\d+/g, '')
      .replace(/[!?]+$/g, '');
    if (!token || /^\.+$/.test(token) || /^\$\d+$/.test(raw)) continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) {
      if (!stack.length) {
        ended = true;
        study.headers.Result = token;
      }
      continue;
    }
    if (ended && !stack.length)
      throw new Error('Unexpected moves after game result. Import one game at a time.');
    try {
      study = addMove(study, token);
    } catch {
      throw new Error(
        `Cannot read move “${token}” after ${study.nodes[study.cursor].san || 'the starting position'}.`,
      );
    }
    if (!stack.length) lastMain = study.cursor;
  }
  if (stack.length) throw new Error('Unclosed PGN variation.');
  if (Object.keys(study.nodes).length === 1 && !headers.FEN)
    throw new Error('No chess moves found. Paste a PGN game or use the FEN tab.');
  return { ...study, cursor: lastMain };
}
const escapeHeader = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, ' ');
const commentText = (s: string) => (s ? `{${s.replace(/[{}]/g, '')}}` : '');
export function exportPgn(study: Study): string {
  const headers = { ...study.headers };
  if (study.rootFen !== DEFAULT_POSITION) {
    headers.SetUp = '1';
    headers.FEN = study.rootFen;
  } else {
    delete headers.SetUp;
    delete headers.FEN;
  }
  headers.Result ||= '*';
  function line(first: string): string {
    const parts: string[] = [];
    let id: string | undefined = first;
    while (id) {
      const node: MoveNode = study.nodes[id];
      const parent = study.nodes[node.parent!];
      parts.push(moveLabel(parent.fen).replace('…', '...'), node.san, commentText(node.comment));
      if (id !== first)
        for (const sibling of parent.children.slice(1)) parts.push(`(${line(sibling)})`);
      id = node.children[0];
    }
    return parts.filter(Boolean).join(' ');
  }
  const root = study.nodes.root;
  const moves = root.children[0] ? line(root.children[0]) : '';
  // Root alternatives belong immediately after the first main move.
  let text = moves;
  if (root.children.length > 1) {
    const first = study.nodes[root.children[0]];
    const prefix = [moveLabel(root.fen).replace('…', '...'), first.san, commentText(first.comment)]
      .filter(Boolean)
      .join(' ');
    text =
      prefix +
      ' ' +
      root.children
        .slice(1)
        .map((id) => `(${line(id)})`)
        .join(' ') +
      moves.slice(prefix.length);
  }
  return (
    Object.entries(headers)
      .map(([k, v]) => `[${k} "${escapeHeader(v)}"]`)
      .join('\n') +
    '\n\n' +
    [commentText(root.comment), text, headers.Result].filter(Boolean).join(' ')
  );
}
