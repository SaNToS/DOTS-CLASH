'use strict';
const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'botMemory.json');
const BEAM_SIZE = 15;   // top N candidates to consider per minimax node
const DIRS4 = [[0,1],[0,-1],[1,0],[-1,0]];

// ─── Memory ────────────────────────────────────────────────────────────────

const defaultMemory = () => ({
  botPatterns: {},    // patternKey -> score (bot's good patterns)
  humanPatterns: {},  // patternKey -> score (human's effective patterns to counter)
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
});

let _memCache = null;

const loadMemory = () => {
  if (_memCache) return _memCache;
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      // Migrate from old format (patterns -> botPatterns)
      if (raw.patterns && !raw.botPatterns) {
        raw.botPatterns = raw.patterns;
        delete raw.patterns;
        if (raw.weights) delete raw.weights;
      }
      _memCache = { ...defaultMemory(), ...raw };
      return _memCache;
    }
  } catch {}
  _memCache = defaultMemory();
  return _memCache;
};

const saveMemory = (memory) => {
  _memCache = memory;
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory));
  } catch (e) {
    console.error('botMemory save err', e);
  }
};

// ─── Pattern Key ───────────────────────────────────────────────────────────
// 3x3 window around (x,y) using raw board values (0-4, 'X' for OOB)

const getPatternKey = (board, x, y, size) => {
  let key = '';
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) key += board[ny][nx];
      else key += 'X';
    }
  }
  return key;
};

// ─── Standalone Capture Detection ─────────────────────────────────────────
// Works directly on board arrays without a game object (for minimax simulation)

const runCaptures = (board, score, playerIdx, size) => {
  const p = playerIdx + 1;          // 1 or 2
  const opp = p === 1 ? 2 : 1;
  const p_terr = p === 1 ? 3 : 4;

  // Flood fill from border: mark all cells reachable without crossing `p`
  const escaped = new Uint8Array(size * size);
  const queue = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x === 0 || x === size - 1 || y === 0 || y === size - 1) && board[y][x] !== p) {
        const idx = y * size + x;
        if (!escaped[idx]) { escaped[idx] = 1; queue.push(idx); }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % size, cy = (idx / size) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
        const nidx = ny * size + nx;
        if (!escaped[nidx] && board[ny][nx] !== p) { escaped[nidx] = 1; queue.push(nidx); }
      }
    }
  }

  // Find enclosed components containing enemy dots and capture them
  const visited = new Uint8Array(size * size);
  let totalCaptured = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!escaped[idx] && board[y][x] !== p && !visited[idx]) {
        const comp = [idx];
        visited[idx] = 1;
        let hasEnemy = board[y][x] === opp;

        let ci = 0;
        while (ci < comp.length) {
          const cidx = comp[ci++];
          const cx2 = cidx % size, cy2 = (cidx / size) | 0;
          for (const [dx, dy] of DIRS4) {
            const nx = cx2 + dx, ny = cy2 + dy;
            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
              const nidx = ny * size + nx;
              if (!escaped[nidx] && board[ny][nx] !== p && !visited[nidx]) {
                visited[nidx] = 1;
                comp.push(nidx);
                if (board[ny][nx] === opp) hasEnemy = true;
              }
            }
          }
        }

        if (hasEnemy) {
          for (const cidx of comp) {
            const cx2 = cidx % size, cy2 = (cidx / size) | 0;
            if (board[cy2][cx2] === opp) totalCaptured++;
            board[cy2][cx2] = p_terr;
          }
        }
      }
    }
  }

  score[playerIdx] += totalCaptured;
  return totalCaptured;
};

// Simulate one move; returns new board + score (does not mutate inputs)
const simulateMove = (board, score, x, y, playerIdx, size) => {
  const newBoard = board.map(row => row.slice());
  const newScore = [score[0], score[1]];
  newBoard[y][x] = playerIdx + 1;
  const captured = runCaptures(newBoard, newScore, playerIdx, size);
  return { board: newBoard, score: newScore, captured };
};

// ─── Static Evaluation ────────────────────────────────────────────────────
// Higher = better for bot. Assesses group vulnerability and score lead.

const staticEval = (board, score, botIdx, size) => {
  const botDot = botIdx + 1;
  const oppDot = (1 - botIdx) + 1;

  // Score difference is the primary signal
  let value = (score[botIdx] - score[1 - botIdx]) * 200;

  // Analyse every dot group once, measuring how "trapped" each group is
  const processed = new Uint8Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const v = board[y][x];
      if ((v !== botDot && v !== oppDot) || processed[idx]) continue;

      const isBot = v === botDot;
      const dotValue = v;

      // BFS to find the connected group and its liberties
      const groupQ = [idx];
      processed[idx] = 1;
      let groupSize = 0;
      const libertySet = new Set();

      let qi = 0;
      while (qi < groupQ.length) {
        const cidx = groupQ[qi++];
        const cx = cidx % size, cy = (cidx / size) | 0;
        groupSize++;

        for (const [dx, dy] of DIRS4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          const nidx = ny * size + nx;
          const nv = board[ny][nx];
          if (nv === dotValue && !processed[nidx]) {
            processed[nidx] = 1;
            groupQ.push(nidx);
          } else if (nv === 0) {
            libertySet.add(nidx);
          }
        }
      }

      const libs = libertySet.size;

      if (isBot) {
        // Our groups threatened = bad
        if (libs === 1) value -= groupSize * 80;
        else if (libs === 2) value -= groupSize * 30;
        else if (libs === 3) value -= groupSize * 8;
      } else {
        // Opponent groups threatened = good
        if (libs === 1) value += groupSize * 100;
        else if (libs === 2) value += groupSize * 50;
        else if (libs === 3) value += groupSize * 18;
        else if (libs === 4) value += groupSize * 6;
      }
    }
  }

  return value;
};

// ─── Candidate Move Generation ────────────────────────────────────────────
// Only consider empty cells near existing pieces (radius = 2).
// Falls back to center region when the board is empty.

const getCandidateMoves = (board, size, radius = 2) => {
  const candidates = new Uint8Array(size * size);
  let hasAny = false;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x] !== 0) {
        hasAny = true;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === 0) {
              candidates[ny * size + nx] = 1;
            }
          }
        }
      }
    }
  }

  if (!hasAny) {
    // Empty board — start near centre
    const c = Math.floor(size / 2);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = c + dx, ny = c + dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) candidates[ny * size + nx] = 1;
      }
    }
  }

  const moves = [];
  for (let i = 0; i < size * size; i++) {
    if (candidates[i]) moves.push({ x: i % size, y: (i / size) | 0 });
  }
  return moves;
};

// ─── Quick Prescore (cheap, no simulation — for beam pruning inside minimax) ──
// Deliberately avoids simulateMove so each internal minimax node stays fast.

const quickScore = (board, x, y, playerIdx, oppIdx, size, botPatterns, humanPatterns) => {
  let s = 0;

  const key = getPatternKey(board, x, y, size);
  s += (botPatterns[key] || 0) * 12;
  s -= (humanPatterns[key] || 0) * 8;

  const botDot = playerIdx + 1;
  const oppDot = oppIdx + 1;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
      if (board[ny][nx] === botDot) s += 15;
      else if (board[ny][nx] === oppDot) s += 22;
    }
  }

  return s;
};

// ─── Minimax with Alpha-Beta Pruning ──────────────────────────────────────

const minimax = (board, score, botIdx, size, depth, alpha, beta, isMaximizing, memory) => {
  if (depth === 0) return staticEval(board, score, botIdx, size);

  const currentPlayer = isMaximizing ? botIdx : 1 - botIdx;
  const oppOfCurrent = 1 - currentPlayer;
  const allCandidates = getCandidateMoves(board, size);

  if (allCandidates.length === 0) return staticEval(board, score, botIdx, size);

  // Score candidates and keep top BEAM_SIZE for this node (cheap — no simulation)
  const scored = allCandidates.map(m => ({
    ...m,
    qs: quickScore(board, m.x, m.y, currentPlayer, oppOfCurrent, size,
      isMaximizing ? memory.botPatterns : {},
      isMaximizing ? memory.humanPatterns : {}),
  }));
  scored.sort((a, b) => b.qs - a.qs);
  const beam = scored.slice(0, BEAM_SIZE);

  if (isMaximizing) {
    let best = -Infinity;
    for (const move of beam) {
      const { board: nb, score: ns } = simulateMove(board, score, move.x, move.y, currentPlayer, size);
      const val = minimax(nb, ns, botIdx, size, depth - 1, alpha, beta, false, memory);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of beam) {
      const { board: nb, score: ns } = simulateMove(board, score, move.x, move.y, currentPlayer, size);
      const val = minimax(nb, ns, botIdx, size, depth - 1, alpha, beta, true, memory);
      if (val < best) best = val;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }
    return best;
  }
};

// ─── Main Bot Move Entry Point ────────────────────────────────────────────

const getBotMove = (game, botPlayerIndex) => {
  const size = game.boardSize;
  const board = game.board;
  const score = game.score;
  const oppIdx = 1 - botPlayerIndex;
  const memory = loadMemory();

  const candidates = getCandidateMoves(board, size);
  if (candidates.length === 0) return null;

  // ── Phase 1: Always grab an immediate capture ──────────────────────────
  for (const move of candidates) {
    const { captured } = simulateMove(board, score, move.x, move.y, botPlayerIndex, size);
    if (captured > 0) {
      move.patternKey = getPatternKey(board, move.x, move.y, size);
      return move;
    }
  }

  // ── Phase 2: Block opponent's immediate capture ────────────────────────
  for (const move of candidates) {
    const { captured } = simulateMove(board, score, move.x, move.y, oppIdx, size);
    if (captured > 0) {
      move.patternKey = getPatternKey(board, move.x, move.y, size);
      return move;
    }
  }

  // ── Phase 3: Minimax search ────────────────────────────────────────────
  // Count true empty cells for depth scaling (never use candidates.length —
  // that's near-piece count, not game-phase indicator).
  let emptyCount = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (board[y][x] === 0) emptyCount++;

  // Depth 3 is safe for all board sizes; go deeper only late game.
  const depth = emptyCount < 15 ? 5
              : emptyCount < 50 ? 4
              : 3;

  // Pre-score all candidates and take top BEAM_SIZE for the root
  // (use simulateMove here at root only — this is O(candidates) not O(candidates^depth))
  const prescored = candidates.map(m => {
    const { captured } = simulateMove(board, score, m.x, m.y, botPlayerIndex, size);
    const qs = captured * 600 + quickScore(board, m.x, m.y, botPlayerIndex, oppIdx, size,
      memory.botPatterns, memory.humanPatterns);
    return { ...m, qs };
  });
  prescored.sort((a, b) => b.qs - a.qs);
  const topCandidates = prescored.slice(0, BEAM_SIZE);

  let bestMove = null;
  let bestVal = -Infinity;

  for (const move of topCandidates) {
    const { board: nb, score: ns, captured: _c } = simulateMove(board, score, move.x, move.y, botPlayerIndex, size);
    const val = minimax(nb, ns, botPlayerIndex, size, depth - 1, -Infinity, Infinity, false, memory);
    if (val > bestVal) {
      bestVal = val;
      bestMove = move;
    }
  }

  if (bestMove) bestMove.patternKey = getPatternKey(board, bestMove.x, bestMove.y, size);
  return bestMove || topCandidates[0] || candidates[0];
};

// ─── Learning ─────────────────────────────────────────────────────────────
// Called after each bot game. Attributes credit to moves based on:
//  - whether they directly caused captures (high value)
//  - whether they set up captures in the next 1-2 moves (medium value)
//  - overall win/loss outcome (low background signal)
// Also records human moves that led to captures for future counter-play.

const updatePatternsFromGame = (gameHistory, winnerIndex, botPlayerIndex) => {
  const memory = loadMemory();
  const botWon = winnerIndex === botPlayerIndex;

  memory.gamesPlayed++;
  if (botWon) memory.wins++;
  else if (winnerIndex !== null) memory.losses++;

  if (!memory.botPatterns) memory.botPatterns = {};
  if (!memory.humanPatterns) memory.humanPatterns = {};

  // Tag moves that directly caused captures
  const captureSet = new Set();
  for (let i = 0; i < gameHistory.length; i++) {
    if (gameHistory[i].captures && gameHistory[i].captures.length > 0) captureSet.add(i);
  }

  for (let i = 0; i < gameHistory.length; i++) {
    const move = gameHistory[i];
    if (!move.pattern) continue;

    const isDirectCapture = captureSet.has(i);
    const isSetupMove = captureSet.has(i + 1) || captureSet.has(i + 2);

    if (move.playerIndex === botPlayerIndex) {
      if (isDirectCapture) {
        memory.botPatterns[move.pattern] = (memory.botPatterns[move.pattern] || 0) + (botWon ? 6 : 3);
      } else if (isSetupMove && botWon) {
        memory.botPatterns[move.pattern] = (memory.botPatterns[move.pattern] || 0) + 2;
      } else if (botWon) {
        memory.botPatterns[move.pattern] = (memory.botPatterns[move.pattern] || 0) + 0.5;
      } else {
        memory.botPatterns[move.pattern] = (memory.botPatterns[move.pattern] || 0) - 0.5;
      }
    } else {
      // Human moves: learn what effective human play looks like so we can counter it
      if (isDirectCapture) {
        const reward = botWon ? 1 : 4; // human capturing and winning = most important to counter
        memory.humanPatterns[move.pattern] = (memory.humanPatterns[move.pattern] || 0) + reward;
      } else if (isSetupMove && !botWon) {
        memory.humanPatterns[move.pattern] = (memory.humanPatterns[move.pattern] || 0) + 1.5;
      }
    }
  }

  // Cap values to prevent unbounded growth
  for (const k of Object.keys(memory.botPatterns)) {
    memory.botPatterns[k] = Math.max(-15, Math.min(60, memory.botPatterns[k]));
    if (Math.abs(memory.botPatterns[k]) < 0.1) delete memory.botPatterns[k];
  }
  for (const k of Object.keys(memory.humanPatterns)) {
    memory.humanPatterns[k] = Math.max(0, Math.min(40, memory.humanPatterns[k]));
    if (memory.humanPatterns[k] < 0.1) delete memory.humanPatterns[k];
  }

  saveMemory(memory);
};

module.exports = {
  loadMemory,
  saveMemory,
  getPatternKey,
  getBotMove,
  updatePatternsFromGame,
};
