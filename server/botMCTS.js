'use strict';

const path = require('path');
const os   = require('os');

const {
  simulateMove,
  getCandidateMoves,
  getPatternKey,
} = require('./botAI');

// ── Worker pool ────────────────────────────────────────────────────────────
// Workers are created once (lazy) and reused across moves.
// Each worker runs independently and returns its root children stats.
// Main thread merges by summing visits+wins, then picks most-visited move.

const N_WORKERS = Math.max(1, Math.min((os.cpus().length || 2) - 1, 4));
const TOTAL_ITERATIONS = 1400; // split evenly across workers

let _pool = null; // array of { worker, resolve }

const initPool = () => {
  if (_pool) return;
  const { Worker } = require('worker_threads');
  _pool = Array.from({ length: N_WORKERS }, () => {
    const entry = { worker: null, resolve: null };
    entry.worker = new Worker(path.join(__dirname, 'botMCTS_worker.js'));
    entry.worker.on('message', (msg) => {
      if (entry.resolve) { entry.resolve(msg); entry.resolve = null; }
    });
    entry.worker.on('error', (err) => {
      console.error('MCTS worker error:', err);
      if (entry.resolve) { entry.resolve([]); entry.resolve = null; }
    });
    return entry;
  });
};

const sendJob = (entry, data) => new Promise((resolve) => {
  entry.resolve = resolve;
  entry.worker.postMessage(data);
});

// Convert 2D board to flat Uint8Array
const toFlat = (board, size) => {
  const flat = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      flat[y * size + x] = board[y][x];
  return flat;
};

// Merge children arrays from multiple workers into one map, then return sorted
const mergeChildren = (allResults) => {
  const map = new Map();
  for (const children of allResults) {
    for (const c of children) {
      const key = `${c.x},${c.y}`;
      const existing = map.get(key);
      if (existing) {
        existing.visits += c.visits;
        existing.wins   += c.wins;
      } else {
        map.set(key, { x: c.x, y: c.y, visits: c.visits, wins: c.wins });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.visits - a.visits);
};

// ── Parallel MCTS ──────────────────────────────────────────────────────────

const getBotMoveMCTSAsync = async (game, botPlayerIndex) => {
  const size   = game.boardSize;
  const board  = game.board;
  const score  = game.score;
  const oppIdx = 1 - botPlayerIndex;

  const candidates = getCandidateMoves(board, size, botPlayerIndex);
  if (candidates.length === 0) return null;

  // Phase 1: immediate capture
  for (const m of candidates) {
    const { captured } = simulateMove(board, score, m.x, m.y, botPlayerIndex, size);
    if (captured > 0) {
      m.patternKey = getPatternKey(board, m.x, m.y, size);
      return m;
    }
  }

  // Phase 2: block opponent's immediate capture
  for (const m of candidates) {
    const { captured } = simulateMove(board, score, m.x, m.y, oppIdx, size);
    if (captured > 0) {
      m.patternKey = getPatternKey(board, m.x, m.y, size);
      return m;
    }
  }

  // Phase 3: parallel MCTS via worker pool
  initPool();

  const itersPerWorker = Math.ceil(TOTAL_ITERATIONS / N_WORKERS);
  const boardFlat      = toFlat(board, size);
  const jobData        = {
    boardFlat,
    score:      [...score],
    turn:       game.turn,
    botIdx:     botPlayerIndex,
    size,
    iterations: itersPerWorker,
  };

  // Send same job to all workers simultaneously
  const results = await Promise.all(_pool.map(entry => sendJob(entry, jobData)));

  const merged = mergeChildren(results);
  if (merged.length === 0) return candidates[0] || null;

  const best = merged[0]; // highest visits
  best.patternKey = getPatternKey(board, best.x, best.y, size);
  return best;
};

// ── Single-thread MCTS (used by trainBot.js) ───────────────────────────────
// Same logic but in-process, accepts configurable iteration count.

const DIRS4 = [[0,1],[0,-1],[1,0],[-1,0]];
const C_UCB = Math.SQRT2;
const ROLLOUT_DEPTH = 15;

const { runCaptures } = require('./botAI');

const rolloutSingle = (board, score, turn, botIdx, size) => {
  let b = board.map(r => r.slice());
  let s = [score[0], score[1]];
  let t = turn;

  for (let d = 0; d < ROLLOUT_DEPTH; d++) {
    const cands = getCandidateMoves(b, size, undefined, 2);
    if (cands.length === 0) break;

    for (let i = cands.length - 1; i > 0; i--) {
      const j = (Math.random() * (i+1)) | 0;
      const tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
    }

    // Capture check: temporarily place, check, restore (no full board copy)
    let chosen = null;
    for (const m of cands) {
      b[m.y][m.x] = t + 1;
      const tmpScore = [0, 0];
      // Create a shallow board copy only for capture detection
      const tb = b.map(r => r.slice());
      if (runCaptures(tb, tmpScore, t, size) > 0) { chosen = m; }
      b[m.y][m.x] = 0; // restore
      if (chosen) break;
    }
    if (!chosen) chosen = cands[0];

    const res = simulateMove(b, s, chosen.x, chosen.y, t, size);
    b = res.board; s = res.score; t = 1 - t;
  }

  const diff = s[botIdx] - s[1 - botIdx];
  return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
};

const makeNode = (board, score, turn, move, parent) => ({
  board, score: [...score], turn, move, parent,
  children: [], visits: 0, wins: 0, untriedMoves: null,
});

const selectChild = (node, botIdx) => {
  const logP = Math.log(node.visits);
  let best = null, bestScore = -Infinity;
  for (const c of node.children) {
    const sc = c.visits === 0 ? Infinity
      : (node.turn === botIdx ? c.wins / c.visits : 1 - c.wins / c.visits)
        + C_UCB * Math.sqrt(logP / c.visits);
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best;
};

const getBotMoveMCTS = (game, botPlayerIndex, iterations = TOTAL_ITERATIONS) => {
  const size   = game.boardSize;
  const board  = game.board;
  const score  = game.score;
  const oppIdx = 1 - botPlayerIndex;

  const candidates = getCandidateMoves(board, size, botPlayerIndex);
  if (candidates.length === 0) return null;

  for (const m of candidates) {
    if (simulateMove(board, score, m.x, m.y, botPlayerIndex, size).captured > 0) {
      m.patternKey = getPatternKey(board, m.x, m.y, size);
      return m;
    }
  }
  for (const m of candidates) {
    if (simulateMove(board, score, m.x, m.y, oppIdx, size).captured > 0) {
      m.patternKey = getPatternKey(board, m.x, m.y, size);
      return m;
    }
  }

  const root = makeNode(board.map(r => r.slice()), [...score], game.turn, null, null);

  for (let it = 0; it < iterations; it++) {
    let node = root;
    while (node.untriedMoves !== null && node.untriedMoves.length === 0 && node.children.length > 0)
      node = selectChild(node, botPlayerIndex);

    if (node.untriedMoves === null) {
      const moves = getCandidateMoves(node.board, size, undefined, 3);
      for (let i = moves.length - 1; i > 0; i--) {
        const j = (Math.random() * (i+1)) | 0;
        [moves[i], moves[j]] = [moves[j], moves[i]];
      }
      node.untriedMoves = moves;
    }

    if (node.untriedMoves.length > 0) {
      const m = node.untriedMoves.pop();
      const { board: nb, score: ns } = simulateMove(node.board, node.score, m.x, m.y, node.turn, size);
      const child = makeNode(nb, ns, 1 - node.turn, m, node);
      node.children.push(child);
      node = child;
    }

    const result = rolloutSingle(node.board, node.score, node.turn, botPlayerIndex, size);
    let cur = node;
    while (cur) { cur.visits++; cur.wins += result; cur = cur.parent; }
  }

  if (!root.children.length) return candidates[0] || null;
  const best = root.children.reduce((a, b) => a.visits > b.visits ? a : b);
  best.move.patternKey = getPatternKey(board, best.move.x, best.move.y, size);
  return best.move;
};

module.exports = { getBotMoveMCTS, getBotMoveMCTSAsync };
