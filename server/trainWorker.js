'use strict';
/**
 * trainWorker.js — worker_thread that simulates one complete game per message.
 *
 * workerData: { type0, type1, boardSize, mctsIters }
 * Receives:   any message (treated as "run one game")
 * Sends:      { ok: true, history, winner, score }
 *           | { ok: false, error: string }
 */
const { workerData, parentPort } = require('worker_threads');

const { createGame, processMove, hasMovesLeft, passTurn } = require('./gameLogic');
const { getBotMove, getPatternKey } = require('./botAI');
const { getBotMoveMCTS } = require('./botMCTS');

const { type0, type1, boardSize, mctsIters } = workerData;

const moveFor = (type, game, idx) => {
  if (type === 'mcts') return getBotMoveMCTS(game, idx, mctsIters);
  return getBotMove(game, idx);
};

const simulateGame = () => {
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

  // Return history without board/score snapshots to keep message size small
  const history = (game.history || []).map(h => ({
    x:           h.x,
    y:           h.y,
    playerIndex: h.playerIndex,
    captures:    h.captures,
    patternKey:  h.patternKey,
  }));

  return { winner, score: [...game.score], history };
};

parentPort.on('message', () => {
  try {
    const result = simulateGame();
    parentPort.postMessage({ ok: true, ...result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
});
