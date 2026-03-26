#!/usr/bin/env node
'use strict';

/**
 * DotMaster Self-Play Training
 *
 * Usage:
 *   node trainBot.js [options]
 *
 * Options:
 *   --games=N      Number of self-play games        (default: 200)
 *   --mode=MODE    Bot matchup: minimax | mcts | mixed  (default: mixed)
 *                    minimax  — minimax vs minimax  (fastest, ~2 min)
 *                    mixed    — mcts vs minimax     (balanced, ~8 min)
 *                    mcts     — mcts vs mcts        (strongest, ~15 min)
 *   --size=N       Board size NxN                   (default: 12)
 *   --iters=N      MCTS iterations per move         (default: 200)
 *   --log=N        Print progress every N games     (default: 10)
 *
 * Examples:
 *   node trainBot.js                                  # quick 200-game run
 *   node trainBot.js --games=1000 --size=10           # fast bulk training
 *   node trainBot.js --games=100 --mode=mcts --iters=400  # high-quality games
 */

const { createGame, processMove, hasMovesLeft, passTurn } = require('./gameLogic');
const { getBotMove, getPatternKey, updatePatternsFromGame, loadMemory } = require('./botAI');
const { getBotMoveMCTS } = require('./botMCTS');
const fs   = require('fs');
const path = require('path');

// ─── CLI args ──────────────────────────────────────────────────────────────
const getArg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};

if (process.argv.includes('--help')) {
  console.log(fs.readFileSync(__filename, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[0]);
  process.exit(0);
}

const TOTAL_GAMES = parseInt(getArg('games',  '200'));
const MODE        =          getArg('mode',   'mixed');
const BOARD_SIZE  = parseInt(getArg('size',   '12'));
const MCTS_ITERS  = parseInt(getArg('iters',  '200'));
const LOG_EVERY   = parseInt(getArg('log',    '10'));

const STATS_FILE  = path.join(__dirname, 'trainStats.json');

// ─── Bot move selection ────────────────────────────────────────────────────
const moveFor = (type, game, idx) => {
  if (type === 'mcts') return getBotMoveMCTS(game, idx, MCTS_ITERS);
  return getBotMove(game, idx);
};

// ─── Simulate one complete game ────────────────────────────────────────────
const simulateGame = (type0, type1, boardSize) => {
  const players = [
    { id: 'p0', nickname: type0, color: 'blue', isBot: true },
    { id: 'p1', nickname: type1, color: 'red',  isBot: true },
  ];
  const first = Math.random() < 0.5 ? 0 : 1;
  const game  = createGame(boardSize, players, first);

  const MAX_MOVES = boardSize * boardSize + 4;

  for (let n = 0; n < MAX_MOVES; n++) {
    if (!hasMovesLeft(game) || game.passes >= 2) break;

    const idx  = game.turn;
    const type = idx === 0 ? type0 : type1;

    let move = null;
    try { move = moveFor(type, game, idx); } catch {}

    if (move) {
      const pKey = getPatternKey(game.board, move.x, move.y, boardSize);
      processMove(game, move.x, move.y, idx, pKey);
    } else {
      passTurn(game);
    }
  }

  let winner = null;
  if      (game.score[0] > game.score[1]) winner = 0;
  else if (game.score[1] > game.score[0]) winner = 1;

  return { game, winner, score: [...game.score] };
};

// ─── Stats persistence ─────────────────────────────────────────────────────
const loadStats = () => {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch { return { totalGames: 0, wins: { p0: 0, p1: 0, draw: 0 }, sessions: [] }; }
};
const saveStats = (s) => fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2));

// ─── Formatting helpers ────────────────────────────────────────────────────
const pad    = (s, n) => String(s).padStart(n);
const pct    = (n, d) => d === 0 ? '—' : (n / d * 100).toFixed(1) + '%';
const fmtSec = (ms) => {
  const s = ms / 1000;
  if (s < 60)  return s.toFixed(1) + 's';
  return `${(s / 60) | 0}m ${(s % 60).toFixed(0)}s`;
};
const bar = (done, total, width = 20) => {
  const filled = Math.round(done / total * width);
  return '[' + '='.repeat(filled) + (filled < width ? '>' : '') + ' '.repeat(Math.max(0, width - filled - 1)) + ']';
};

// ─── Main ──────────────────────────────────────────────────────────────────
const MODES = { minimax: ['minimax','minimax'], mcts: ['mcts','mcts'], mixed: ['mcts','minimax'] };
const [type0, type1] = MODES[MODE] || MODES.mixed;

console.log('\n  ╔══════════════════════════════════════════════╗');
console.log('  ║      DotMaster Self-Play Training            ║');
console.log('  ╚══════════════════════════════════════════════╝\n');
console.log(`  Games : ${TOTAL_GAMES}    Board : ${BOARD_SIZE}x${BOARD_SIZE}    Mode : ${type0} vs ${type1}`);
if (MODE !== 'minimax') console.log(`  MCTS iterations per move : ${MCTS_ITERS}`);
console.log('');

const globalStats = loadStats();
let wins = [0, 0], draws = 0;
const startTime = Date.now();

for (let g = 1; g <= TOTAL_GAMES; g++) {
  const { game, winner, score } = simulateGame(type0, type1, BOARD_SIZE);

  // Learn from this game — always from p0's perspective so patterns
  // accumulate towards winning strategies for the deployed bot
  updatePatternsFromGame(game.history, winner, 0);
  // Also from p1's perspective to double the learning signal
  updatePatternsFromGame(game.history, winner, 1);

  if      (winner === 0) wins[0]++;
  else if (winner === 1) wins[1]++;
  else                   draws++;

  if (g % LOG_EVERY === 0 || g === TOTAL_GAMES) {
    const elapsed = Date.now() - startTime;
    const gps     = (g / (elapsed / 1000)).toFixed(2);
    const eta     = g < TOTAL_GAMES ? fmtSec((TOTAL_GAMES - g) / parseFloat(gps) * 1000) : '—';

    process.stdout.write(
      `\r  ${bar(g, TOTAL_GAMES)} ${pad(g, 5)}/${TOTAL_GAMES}` +
      `  ${type0}: ${pct(wins[0], g)}  ${type1}: ${pct(wins[1], g)}  draw: ${pct(draws, g)}` +
      `  ${gps} g/s  ETA ${eta}  `
    );
  }
}

// Persist session stats
const elapsed = Date.now() - startTime;
globalStats.totalGames += TOTAL_GAMES;
globalStats.wins.p0   = (globalStats.wins.p0   || 0) + wins[0];
globalStats.wins.p1   = (globalStats.wins.p1   || 0) + wins[1];
globalStats.wins.draw = (globalStats.wins.draw  || 0) + draws;
globalStats.sessions  = (globalStats.sessions   || []);
globalStats.sessions.push({
  date: new Date().toISOString(),
  games: TOTAL_GAMES, mode: MODE, boardSize: BOARD_SIZE, mctsIters: MCTS_ITERS,
  wins: [wins[0], wins[1], draws],
  durationMs: elapsed,
});
// Keep only last 20 sessions in log
if (globalStats.sessions.length > 20) globalStats.sessions.splice(0, globalStats.sessions.length - 20);
saveStats(globalStats);

const mem = loadMemory();

console.log('\n\n  ─────────────────────────────────────────────');
console.log('  Results:');
console.log(`    ${type0.padEnd(8)} wins : ${wins[0]} / ${TOTAL_GAMES}  (${pct(wins[0], TOTAL_GAMES)})`);
console.log(`    ${type1.padEnd(8)} wins : ${wins[1]} / ${TOTAL_GAMES}  (${pct(wins[1], TOTAL_GAMES)})`);
console.log(`    draws          : ${draws} / ${TOTAL_GAMES}  (${pct(draws, TOTAL_GAMES)})`);
console.log(`    time           : ${fmtSec(elapsed)}`);
console.log('');
console.log('  Memory after training:');
console.log(`    total games in memory : ${mem.gamesPlayed}`);
console.log(`    bot patterns          : ${Object.keys(mem.botPatterns || {}).length}`);
console.log(`    opponent patterns     : ${Object.keys(mem.humanPatterns || {}).length}`);
console.log('  ─────────────────────────────────────────────\n');
