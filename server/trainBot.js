#!/usr/bin/env node
'use strict';

/**
 * DotMaster Self-Play Training  (parallel worker pool edition)
 *
 * Usage:
 *   node trainBot.js [options]
 *
 * Options:
 *   --games=N      Number of self-play games             (default: 200)
 *   --mode=MODE    Bot matchup: minimax | mcts | mixed    (default: mixed)
 *                    minimax  — minimax vs minimax  (fastest, no MCTS overhead)
 *                    mixed    — mcts vs minimax     (balanced quality/speed)
 *                    mcts     — mcts vs mcts        (strongest games)
 *   --size=N       Board size NxN                         (default: 12)
 *   --iters=N      MCTS iterations per move               (default: 200)
 *   --workers=N    Override worker count (default: CPUs-1, max 64)
 *   --log=N        Refresh progress display every N ms    (default: 500)
 *
 * Examples:
 *   node trainBot.js --games=500 --mode=minimax --size=10
 *   node trainBot.js --games=200 --mode=mcts --iters=300
 *   node trainBot.js --games=5000 --mode=minimax --workers=26
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { Worker } = require('worker_threads');

const { updatePatternsFromGame, loadMemory } = require('./botAI');

// ─── CLI args ──────────────────────────────────────────────────────────────
const getArg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};

if (process.argv.includes('--help')) {
  const src = fs.readFileSync(__filename, 'utf8');
  console.log(src.match(/\/\*\*([\s\S]*?)\*\//)[0]);
  process.exit(0);
}

const TOTAL_GAMES  = parseInt(getArg('games',   '200'));
const MODE         =          getArg('mode',    'mixed');
const BOARD_SIZE   = parseInt(getArg('size',    '12'));
const MCTS_ITERS   = parseInt(getArg('iters',   '200'));
const LOG_INTERVAL = parseInt(getArg('log',     '500'));

const maxWorkers   = Math.max(1, (os.cpus().length || 2) - 1);
const N_WORKERS    = Math.min(
  parseInt(getArg('workers', String(maxWorkers))),
  64,
  TOTAL_GAMES   // no point having more workers than games
);

const STATS_FILE   = path.join(__dirname, 'trainStats.json');
const WORKER_FILE  = path.join(__dirname, 'trainWorker.js');

const MODES  = { minimax: ['minimax','minimax'], mcts: ['mcts','mcts'], mixed: ['mcts','minimax'] };
const [type0, type1] = MODES[MODE] || MODES.mixed;

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
  if (s < 3600) return `${(s / 60) | 0}m ${(s % 60).toFixed(0)}s`;
  return `${(s / 3600) | 0}h ${((s % 3600) / 60).toFixed(0)}m`;
};
const bar = (done, total, width = 24) => {
  const filled = Math.round(done / total * width);
  return '[' + '='.repeat(filled) + (filled < width ? '>' : '') +
         ' '.repeat(Math.max(0, width - filled - 1)) + ']';
};

// ─── Header ───────────────────────────────────────────────────────────────
console.log('\n  ╔══════════════════════════════════════════════╗');
console.log('  ║      DotMaster Self-Play Training  (v2)      ║');
console.log('  ╚══════════════════════════════════════════════╝\n');
console.log(`  Games   : ${TOTAL_GAMES}    Board  : ${BOARD_SIZE}x${BOARD_SIZE}    Mode : ${type0} vs ${type1}`);
console.log(`  Workers : ${N_WORKERS}    CPUs   : ${os.cpus().length}`);
if (MODE !== 'minimax') console.log(`  MCTS iterations per move : ${MCTS_ITERS}`);
console.log('');

// ─── Main ─────────────────────────────────────────────────────────────────
const run = async () => {
  let completed  = 0;
  let wins       = [0, 0];
  let draws      = 0;
  let nextGame   = 0;   // next game index to dispatch
  const startTime = Date.now();

  // Live progress ticker
  const ticker = setInterval(() => {
    if (completed === 0) return;
    const elapsed = Date.now() - startTime;
    const gps     = (completed / (elapsed / 1000)).toFixed(2);
    const eta     = completed < TOTAL_GAMES
      ? fmtSec((TOTAL_GAMES - completed) / parseFloat(gps) * 1000)
      : '—';
    const active  = Math.min(N_WORKERS, TOTAL_GAMES - completed);

    process.stdout.write(
      `\r  ${bar(completed, TOTAL_GAMES)} ${pad(completed, 5)}/${TOTAL_GAMES}` +
      `  ${type0}: ${pct(wins[0], completed)}  ${type1}: ${pct(wins[1], completed)}` +
      `  draw: ${pct(draws, completed)}` +
      `  ${gps} g/s  W:${active}  ETA ${eta}  `
    );
  }, LOG_INTERVAL);

  // Each "slot" runs games in a loop until quota is filled
  const runSlot = (worker) => new Promise((slotResolve) => {
    const dispatch = () => {
      if (nextGame >= TOTAL_GAMES) {
        worker.terminate();
        slotResolve();
        return;
      }
      nextGame++;
      worker.postMessage('go');
    };

    worker.on('message', (msg) => {
      if (msg.ok) {
        // Pattern learning must happen on main thread (single-threaded, no mutex needed)
        updatePatternsFromGame(msg.history, msg.winner, 0);
        updatePatternsFromGame(msg.history, msg.winner, 1);

        if      (msg.winner === 0) wins[0]++;
        else if (msg.winner === 1) wins[1]++;
        else                       draws++;
        completed++;
      } else {
        // Game errored — count it as completed to avoid stalling
        completed++;
        console.error('\n  Worker error:', msg.error);
      }
      dispatch(); // request next game from same worker
    });

    worker.on('error', (err) => {
      completed++;
      console.error('\n  Worker crash:', err.message);
      // Spawn replacement worker
      const replacement = spawnWorker();
      runSlot(replacement).then(slotResolve);
    });

    dispatch(); // kick off first game
  });

  const spawnWorker = () => new Worker(WORKER_FILE, {
    workerData: { type0, type1, boardSize: BOARD_SIZE, mctsIters: MCTS_ITERS },
  });

  const workers = Array.from({ length: N_WORKERS }, spawnWorker);
  await Promise.all(workers.map(runSlot));

  clearInterval(ticker);

  // Final progress line
  const elapsed = Date.now() - startTime;
  const gps = (completed / (elapsed / 1000)).toFixed(2);
  process.stdout.write(
    `\r  ${bar(TOTAL_GAMES, TOTAL_GAMES)} ${pad(TOTAL_GAMES, 5)}/${TOTAL_GAMES}` +
    `  ${type0}: ${pct(wins[0], TOTAL_GAMES)}  ${type1}: ${pct(wins[1], TOTAL_GAMES)}` +
    `  draw: ${pct(draws, TOTAL_GAMES)}  ${gps} g/s  done          \n`
  );

  // ─── Persist session stats ────────────────────────────────────────────
  const globalStats = loadStats();
  globalStats.totalGames         = (globalStats.totalGames || 0) + TOTAL_GAMES;
  globalStats.wins.p0            = (globalStats.wins.p0    || 0) + wins[0];
  globalStats.wins.p1            = (globalStats.wins.p1    || 0) + wins[1];
  globalStats.wins.draw          = (globalStats.wins.draw  || 0) + draws;
  globalStats.sessions           = globalStats.sessions || [];
  globalStats.sessions.push({
    date: new Date().toISOString(),
    games: TOTAL_GAMES, mode: MODE, boardSize: BOARD_SIZE, mctsIters: MCTS_ITERS,
    workers: N_WORKERS,
    wins: [wins[0], wins[1], draws],
    durationMs: elapsed,
  });
  if (globalStats.sessions.length > 20) globalStats.sessions.splice(0, globalStats.sessions.length - 20);
  saveStats(globalStats);

  const mem = loadMemory();

  console.log('\n  ─────────────────────────────────────────────');
  console.log('  Results:');
  console.log(`    ${type0.padEnd(8)} wins : ${wins[0]} / ${TOTAL_GAMES}  (${pct(wins[0], TOTAL_GAMES)})`);
  console.log(`    ${type1.padEnd(8)} wins : ${wins[1]} / ${TOTAL_GAMES}  (${pct(wins[1], TOTAL_GAMES)})`);
  console.log(`    draws          : ${draws} / ${TOTAL_GAMES}  (${pct(draws, TOTAL_GAMES)})`);
  console.log(`    time           : ${fmtSec(elapsed)}  (${N_WORKERS} parallel workers)`);
  console.log(`    throughput     : ${gps} games/sec`);
  console.log('');
  console.log('  Memory after training:');
  console.log(`    total games in memory : ${mem.gamesPlayed}`);
  console.log(`    bot patterns          : ${Object.keys(mem.botPatterns    || {}).length}`);
  console.log(`    opponent patterns     : ${Object.keys(mem.humanPatterns  || {}).length}`);
  console.log('  ─────────────────────────────────────────────\n');
};

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
