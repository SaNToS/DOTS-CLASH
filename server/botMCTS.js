'use strict';

const {
  runCaptures,
  simulateMove,
  getCandidateMoves,
  getPatternKey,
} = require('./botAI');

const DIRS4 = [[0,1],[0,-1],[1,0],[-1,0]];

// ─── MCTS Configuration ────────────────────────────────────────────────────
const ITERATIONS   = 1400;  // simulations per move
const ROLLOUT_DEPTH = 22;   // moves to simulate in each rollout
const C = Math.SQRT2;       // UCB1 exploration constant

// ─── Node ─────────────────────────────────────────────────────────────────

const makeNode = (board, score, turn, move, parent) => ({
  board,
  score,       // [s0, s1]
  turn,        // whose turn it is NEXT from this state
  move,        // {x, y} that led to this node (null for root)
  parent,
  children: [],
  visits: 0,
  wins: 0.0,   // from bot's perspective (0–1 scale)
  untriedMoves: null, // null = not yet generated
});

// ─── UCB1 Selection ────────────────────────────────────────────────────────

// Select best child: maximise if it's bot's turn, minimise otherwise.
const selectChild = (node, botIdx) => {
  const logParent = Math.log(node.visits);
  let best = null;
  let bestScore = -Infinity;

  for (const child of node.children) {
    let score;
    if (child.visits === 0) {
      score = Infinity;
    } else {
      const exploitation = child.wins / child.visits;
      const exploration  = C * Math.sqrt(logParent / child.visits);
      // If the parent's turn is bot → we chose this child for bot → maximise win rate
      // If the parent's turn is opp → we chose this child for opp → minimise bot's win rate
      score = (node.turn === botIdx)
        ? exploitation + exploration
        : (1 - exploitation) + exploration;
    }
    if (score > bestScore) { bestScore = score; best = child; }
  }
  return best;
};

// ─── Rollout ───────────────────────────────────────────────────────────────
// Smart-random playout: always take an immediate capture if one exists,
// otherwise pick randomly from candidate moves.

const rollout = (board, score, turn, botIdx, size) => {
  let b = board.map(r => r.slice());
  let s = [score[0], score[1]];
  let t = turn;

  for (let d = 0; d < ROLLOUT_DEPTH; d++) {
    const cands = getCandidateMoves(b, size, undefined, 2); // radius 2 for speed
    if (cands.length === 0) break;

    // Fisher-Yates shuffle so we don't always try the same order
    for (let i = cands.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
    }

    // Prefer capturing moves
    let chosen = null;
    for (const m of cands) {
      // Quick test: place on a throwaway board
      const tb = b.map(r => r.slice());
      const ts = [s[0], s[1]];
      tb[m.y][m.x] = t + 1;
      if (runCaptures(tb, ts, t, size) > 0) { chosen = m; break; }
    }
    if (!chosen) chosen = cands[0]; // already shuffled, so this is random

    const res = simulateMove(b, s, chosen.x, chosen.y, t, size);
    b = res.board;
    s = res.score;
    t = 1 - t;
  }

  // Evaluate terminal position from bot's perspective
  const diff = s[botIdx] - s[1 - botIdx];
  if (diff > 0) return 1;
  if (diff < 0) return 0;
  return 0.5;
};

// ─── MCTS Main ─────────────────────────────────────────────────────────────

const getBotMoveMCTS = (game, botPlayerIndex, iterations = ITERATIONS) => {
  const size   = game.boardSize;
  const board  = game.board;
  const score  = game.score;
  const oppIdx = 1 - botPlayerIndex;

  const candidates = getCandidateMoves(board, size, botPlayerIndex);
  if (candidates.length === 0) return null;

  // ── Phase 1: Grab immediate capture ──────────────────────────────────
  for (const m of candidates) {
    const { captured } = simulateMove(board, score, m.x, m.y, botPlayerIndex, size);
    if (captured > 0) {
      m.patternKey = getPatternKey(board, m.x, m.y, size);
      return m;
    }
  }

  // ── Phase 2: Block opponent immediate capture ─────────────────────────
  for (const m of candidates) {
    const { captured } = simulateMove(board, score, m.x, m.y, oppIdx, size);
    if (captured > 0) {
      m.patternKey = getPatternKey(board, m.x, m.y, size);
      return m;
    }
  }

  // ── Phase 3: MCTS ─────────────────────────────────────────────────────
  const root = makeNode(
    board.map(r => r.slice()),
    [score[0], score[1]],
    game.turn,
    null,
    null
  );

  for (let iter = 0; iter < iterations; iter++) {
    // 1. Selection — walk down the tree via UCB1
    let node = root;
    while (
      node.untriedMoves !== null &&
      node.untriedMoves.length === 0 &&
      node.children.length > 0
    ) {
      node = selectChild(node, botPlayerIndex);
    }

    // 2. Expansion — lazy-generate untried moves, then expand one
    if (node.untriedMoves === null) {
      const moves = getCandidateMoves(node.board, size, undefined, 3);
      // Shuffle so expansion order is random
      for (let i = moves.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = moves[i]; moves[i] = moves[j]; moves[j] = tmp;
      }
      node.untriedMoves = moves;
    }

    if (node.untriedMoves.length > 0) {
      const move = node.untriedMoves.pop();
      const { board: nb, score: ns } = simulateMove(
        node.board, node.score, move.x, move.y, node.turn, size
      );
      const child = makeNode(nb, ns, 1 - node.turn, move, node);
      node.children.push(child);
      node = child;
    }

    // 3. Rollout from the new (or selected) node
    const result = rollout(node.board, node.score, node.turn, botPlayerIndex, size);

    // 4. Backpropagation — always track wins from bot's perspective
    let cur = node;
    while (cur !== null) {
      cur.visits++;
      cur.wins += result;
      cur = cur.parent;
    }
  }

  // Choose the most-visited child (robust, less sensitive to outliers)
  if (root.children.length === 0) {
    const fallback = candidates[0];
    if (fallback) fallback.patternKey = getPatternKey(board, fallback.x, fallback.y, size);
    return fallback;
  }

  const best = root.children.reduce((a, b) => a.visits > b.visits ? a : b);
  best.move.patternKey = getPatternKey(board, best.move.x, best.move.y, size);
  return best.move;
};

module.exports = { getBotMoveMCTS };
