'use strict';
/**
 * MCTS Worker — runs in a worker_thread.
 * Uses flat Uint8Array boards throughout for maximum copy speed.
 * Key optimisation: wouldCaptureFlat checks captures WITHOUT copying the board
 * (temporarily places a dot, runs flood-fill read-only, then restores).
 */
const { parentPort } = require('worker_threads');

const DIRS4 = [[0,1],[0,-1],[1,0],[-1,0]];
const C = Math.SQRT2;
const ROLLOUT_DEPTH = 15;

// ── Flat board capture engine ──────────────────────────────────────────────
// board: Uint8Array(size*size), cell index = y*size + x

const runCapturesFlat = (board, score, playerIdx, size) => {
  const p     = playerIdx + 1;
  const opp   = p === 1 ? 2 : 1;
  const pTerr = p === 1 ? 3 : 4;
  const N     = size * size;

  const escaped = new Uint8Array(N);
  const queue   = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x === 0 || x === size-1 || y === 0 || y === size-1) && board[y*size+x] !== p) {
        const i = y*size+x;
        if (!escaped[i]) { escaped[i] = 1; queue.push(i); }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const i  = queue[head++];
    const cx = i % size, cy = (i / size) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = cx+dx, ny = cy+dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
        const ni = ny*size+nx;
        if (!escaped[ni] && board[ni] !== p) { escaped[ni] = 1; queue.push(ni); }
      }
    }
  }

  const visited = new Uint8Array(N);
  let total = 0;

  for (let i = 0; i < N; i++) {
    if (escaped[i] || board[i] === p || visited[i]) continue;
    const comp = [i];
    visited[i] = 1;
    let hasEnemy = board[i] === opp;
    let ci = 0;
    while (ci < comp.length) {
      const c2  = comp[ci++];
      const cx2 = c2 % size, cy2 = (c2 / size) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = cx2+dx, ny = cy2+dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
          const ni = ny*size+nx;
          if (!escaped[ni] && board[ni] !== p && !visited[ni]) {
            visited[ni] = 1; comp.push(ni);
            if (board[ni] === opp) hasEnemy = true;
          }
        }
      }
    }
    if (hasEnemy) {
      for (const c2 of comp) {
        if (board[c2] === opp) total++;
        board[c2] = pTerr;
      }
    }
  }

  score[playerIdx] += total;
  return total;
};

// Full simulate (copies board — used for tree expansion)
const simMoveFlat = (board, score, x, y, playerIdx, size) => {
  const nb = new Uint8Array(board); // single fast memcpy
  const ns = [score[0], score[1]];
  nb[y * size + x] = playerIdx + 1;
  runCapturesFlat(nb, ns, playerIdx, size);
  return { board: nb, score: ns };
};

// Check capture WITHOUT copying the board — core rollout optimisation.
// Temporarily places the dot, checks enclosure read-only, then restores.
const wouldCaptureFlat = (board, x, y, playerIdx, size) => {
  const p   = playerIdx + 1;
  const opp = p === 1 ? 2 : 1;
  const idx = y * size + x;
  board[idx] = p; // temporary

  const N       = size * size;
  const escaped = new Uint8Array(N);
  const queue   = [];

  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      if ((ix === 0 || ix === size-1 || iy === 0 || iy === size-1) && board[iy*size+ix] !== p) {
        const i = iy*size+ix;
        if (!escaped[i]) { escaped[i] = 1; queue.push(i); }
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const i  = queue[head++];
    const cx = i % size, cy = (i / size) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = cx+dx, ny = cy+dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
        const ni = ny*size+nx;
        if (!escaped[ni] && board[ni] !== p) { escaped[ni] = 1; queue.push(ni); }
      }
    }
  }

  let trapped = false;
  for (let i = 0; i < N && !trapped; i++) {
    if (!escaped[i] && board[i] === opp) trapped = true;
  }

  board[idx] = 0; // restore
  return trapped;
};

// Candidate empty cells within radius of any piece (flat indices)
const getCandidatesFlat = (board, size, radius = 2) => {
  const seen = new Uint8Array(size * size);
  let hasAny = false;

  for (let i = 0; i < size * size; i++) {
    if (board[i] === 0) continue;
    hasAny = true;
    const x = i % size, y = (i / size) | 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x+dx, ny = y+dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny*size+nx] === 0)
          seen[ny*size+nx] = 1;
      }
    }
  }

  if (!hasAny) {
    const c = (size / 2) | 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = c+dx, ny = c+dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) seen[ny*size+nx] = 1;
      }
  }

  const moves = [];
  for (let i = 0; i < size * size; i++) if (seen[i]) moves.push(i);
  return moves;
};

// ── MCTS Rollout ───────────────────────────────────────────────────────────
// Uses wouldCaptureFlat → no board copies during capture checks.

const rollout = (board, score, turn, botIdx, size) => {
  let b = new Uint8Array(board); // one copy at rollout start
  let s = [score[0], score[1]];
  let t = turn;

  for (let d = 0; d < ROLLOUT_DEPTH; d++) {
    const cands = getCandidatesFlat(b, size, 2);
    if (cands.length === 0) break;

    // Fisher-Yates shuffle
    for (let i = cands.length - 1; i > 0; i--) {
      const j = (Math.random() * (i+1)) | 0;
      const tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
    }

    // Look for a capturing move — uses in-place check (no copy)
    let chosen = -1;
    for (const fi of cands) {
      if (wouldCaptureFlat(b, fi % size, (fi / size) | 0, t, size)) { chosen = fi; break; }
    }
    if (chosen === -1) chosen = cands[0]; // random (shuffled)

    const res = simMoveFlat(b, s, chosen % size, (chosen / size) | 0, t, size);
    b = res.board;
    s = res.score;
    t = 1 - t;
  }

  const diff = s[botIdx] - s[1 - botIdx];
  if (diff > 0) return 1;
  if (diff < 0) return 0;
  return 0.5;
};

// ── MCTS Tree ──────────────────────────────────────────────────────────────

const makeNode = (board, score, turn, move, parent) => ({
  board, score: [score[0], score[1]], turn,
  move,   // flat index (-1 for root)
  parent,
  children: [],
  visits: 0,
  wins: 0,
  untriedMoves: null,
});

const selectChild = (node, botIdx) => {
  const logP = Math.log(node.visits);
  let best = null, bestScore = -Infinity;
  for (const child of node.children) {
    let sc;
    if (child.visits === 0) {
      sc = Infinity;
    } else {
      const expl = C * Math.sqrt(logP / child.visits);
      // Maximise if parent chose for bot, minimise if parent chose for opponent
      sc = (node.turn === botIdx)
        ? (child.wins / child.visits) + expl
        : (1 - child.wins / child.visits) + expl;
    }
    if (sc > bestScore) { bestScore = sc; best = child; }
  }
  return best;
};

const runMCTS = ({ boardFlat, score, turn, botIdx, size, iterations }) => {
  const root = makeNode(new Uint8Array(boardFlat), score, turn, -1, null);

  for (let it = 0; it < iterations; it++) {
    // 1. Selection
    let node = root;
    while (node.untriedMoves !== null && node.untriedMoves.length === 0 && node.children.length > 0) {
      node = selectChild(node, botIdx);
    }

    // 2. Lazy expansion
    if (node.untriedMoves === null) {
      const moves = getCandidatesFlat(node.board, size, 3);
      for (let i = moves.length - 1; i > 0; i--) {
        const j = (Math.random() * (i+1)) | 0;
        const tmp = moves[i]; moves[i] = moves[j]; moves[j] = tmp;
      }
      node.untriedMoves = moves;
    }

    if (node.untriedMoves.length > 0) {
      const fi = node.untriedMoves.pop();
      const cx = fi % size, cy = (fi / size) | 0;
      const { board: nb, score: ns } = simMoveFlat(node.board, node.score, cx, cy, node.turn, size);
      const child = makeNode(nb, ns, 1 - node.turn, fi, node);
      node.children.push(child);
      node = child;
    }

    // 3. Rollout
    const result = rollout(node.board, node.score, node.turn, botIdx, size);

    // 4. Backpropagation (always from bot's perspective)
    let cur = node;
    while (cur !== null) { cur.visits++; cur.wins += result; cur = cur.parent; }
  }

  return root.children.map(c => ({
    x: c.move % size,
    y: (c.move / size) | 0,
    visits: c.visits,
    wins: c.wins,
  }));
};

// ── Message handler ────────────────────────────────────────────────────────
parentPort.on('message', (data) => {
  parentPort.postMessage(runMCTS(data));
});
