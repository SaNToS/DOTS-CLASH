'use strict';
const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'botMemory.json');
const BEAM_SIZE = 15;   // top N candidates per minimax node
const DIRS4 = [[0,1],[0,-1],[1,0],[-1,0]];
const MIN_SAFE_AREA = 10; // placing into fewer cells than this = trap

// ─── Memory ────────────────────────────────────────────────────────────────

const defaultMemory = () => ({
  botPatterns: {},
  humanPatterns: {},
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
  const p = playerIdx + 1;
  const opp = p === 1 ? 2 : 1;
  const p_terr = p === 1 ? 3 : 4;

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

// ─── Reachable Area ────────────────────────────────────────────────────────
// Flood fill from (startX, startY) counting cells reachable without crossing
// opponent dots or opponent territory. Uses a shared visited array so multiple
// calls can accumulate into one global reachability map efficiently.

const reachableAreaFill = (board, startX, startY, oppDot, oppTerr, size, visited) => {
  const start = startY * size + startX;
  if (visited[start]) return 0;
  visited[start] = 1;
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % size, cy = (idx / size) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const nidx = ny * size + nx;
      if (!visited[nidx] && board[ny][nx] !== oppDot && board[ny][nx] !== oppTerr) {
        visited[nidx] = 1;
        queue.push(nidx);
      }
    }
  }
  return queue.length; // number of unique cells reached this call
};

// Standalone version (own visited array) — for single-point queries
const reachableArea = (board, startX, startY, botIdx, size) => {
  const oppDot = botIdx === 0 ? 2 : 1;
  const oppTerr = botIdx === 0 ? 4 : 3;
  return reachableAreaFill(board, startX, startY, oppDot, oppTerr, size, new Uint8Array(size * size));
};

// ─── Static Evaluation ────────────────────────────────────────────────────
// Area-based encirclement analysis: how much space can each side reach?
// Small reachable area = being trapped = heavily penalised.

const staticEval = (board, score, botIdx, size) => {
  const botDot = botIdx + 1;
  const oppDot = (1 - botIdx) + 1;
  const oppTerr = botIdx === 0 ? 4 : 3;
  const botTerr = botIdx === 0 ? 3 : 4;

  // Capture score is the primary signal
  let value = (score[botIdx] - score[1 - botIdx]) * 200;

  const botVisited = new Uint8Array(size * size);
  const oppVisited = new Uint8Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = board[y][x];
      const idx = y * size + x;

      if (v === botDot && !botVisited[idx]) {
        const area = reachableAreaFill(board, x, y, oppDot, oppTerr, size, botVisited);
        // Penalise bot groups in shrinking enclosed regions
        if      (area < 5)  value -= 800;
        else if (area < 12) value -= 350;
        else if (area < 25) value -= 100;
        else if (area < 50) value -= 20;
      }

      if (v === oppDot && !oppVisited[idx]) {
        const area = reachableAreaFill(board, x, y, botDot, botTerr, size, oppVisited);
        // Reward squeezing opponent into a small region
        if      (area < 5)  value += 600;
        else if (area < 12) value += 250;
        else if (area < 25) value += 80;
        else if (area < 50) value += 15;
      }
    }
  }

  return value;
};

// ─── Border Cells (Ring-Breaking Candidates) ──────────────────────────────
// Find empty cells that are reachable from any bot dot AND adjacent to an
// opponent dot. These are the key positions where the bot can break a forming
// ring even if it is far from the bot's current cluster.

const getBorderCells = (board, botIdx, size) => {
  const botDot = botIdx + 1;
  const oppDot = botIdx === 0 ? 2 : 1;
  const oppTerr = botIdx === 0 ? 4 : 3;

  // Flood fill from all bot dots
  const visited = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x] === botDot) {
        reachableAreaFill(board, x, y, oppDot, oppTerr, size, visited);
      }
    }
  }

  // Empty cells reachable from bot that touch an opponent dot
  const border = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x] !== 0 || !visited[y * size + x]) continue;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === oppDot) {
          border.push({ x, y });
          break;
        }
      }
    }
  }
  return border;
};

// ─── Candidate Move Generation ────────────────────────────────────────────
// Radius 3 around all existing pieces, plus ring-breaking border cells when
// botIdx is provided (root call only — skipped inside minimax for speed).

const getCandidateMoves = (board, size, botIdx = undefined, radius = 3) => {
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

  // Add ring-breaking border cells (root only — botIdx provided)
  if (hasAny && botIdx !== undefined) {
    for (const { x, y } of getBorderCells(board, botIdx, size)) {
      candidates[y * size + x] = 1;
    }
  }

  const moves = [];
  for (let i = 0; i < size * size; i++) {
    if (candidates[i]) moves.push({ x: i % size, y: (i / size) | 0 });
  }
  return moves;
};

// ─── Quick Prescore (cheap, for beam pruning inside minimax) ──────────────

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
  // No botIdx in inner nodes — skip border cell computation for speed
  const allCandidates = getCandidateMoves(board, size);

  if (allCandidates.length === 0) return staticEval(board, score, botIdx, size);

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

  // Pass botIdx so border cells (ring-breaking moves) are included
  const candidates = getCandidateMoves(board, size, botPlayerIndex);
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

  // ── Phase 3: Filter trap moves ─────────────────────────────────────────
  // Don't place bot dots inside a small enclosed area (opponent's forming ring).
  // A trap is detected by checking the reachable area after placing the dot.
  const safeCandidates = candidates.filter(m => {
    const testBoard = board.map(r => r.slice());
    testBoard[m.y][m.x] = botPlayerIndex + 1;
    return reachableArea(testBoard, m.x, m.y, botPlayerIndex, size) >= MIN_SAFE_AREA;
  });
  // Keep safe candidates unless we're in deep endgame with no safe squares left
  const effectiveCandidates = safeCandidates.length >= 3 ? safeCandidates : candidates;

  // ── Phase 4: Minimax search ────────────────────────────────────────────
  let emptyCount = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (board[y][x] === 0) emptyCount++;

  const depth = emptyCount < 15 ? 5
              : emptyCount < 50 ? 4
              : 3;

  const prescored = effectiveCandidates.map(m => {
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
    const { board: nb, score: ns } = simulateMove(board, score, move.x, move.y, botPlayerIndex, size);
    const val = minimax(nb, ns, botPlayerIndex, size, depth - 1, -Infinity, Infinity, false, memory);
    if (val > bestVal) {
      bestVal = val;
      bestMove = move;
    }
  }

  if (bestMove) bestMove.patternKey = getPatternKey(board, bestMove.x, bestMove.y, size);
  return bestMove || topCandidates[0] || effectiveCandidates[0];
};

// ─── Learning ─────────────────────────────────────────────────────────────

const updatePatternsFromGame = (gameHistory, winnerIndex, botPlayerIndex) => {
  const memory = loadMemory();
  const botWon = winnerIndex === botPlayerIndex;

  memory.gamesPlayed++;
  if (botWon) memory.wins++;
  else if (winnerIndex !== null) memory.losses++;

  if (!memory.botPatterns) memory.botPatterns = {};
  if (!memory.humanPatterns) memory.humanPatterns = {};

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
      if (isDirectCapture) {
        const reward = botWon ? 1 : 4;
        memory.humanPatterns[move.pattern] = (memory.humanPatterns[move.pattern] || 0) + reward;
      } else if (isSetupMove && !botWon) {
        memory.humanPatterns[move.pattern] = (memory.humanPatterns[move.pattern] || 0) + 1.5;
      }
    }
  }

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
  // Shared simulation helpers (used by botMCTS.js)
  runCaptures,
  simulateMove,
  getCandidateMoves,
  reachableAreaFill,
};
