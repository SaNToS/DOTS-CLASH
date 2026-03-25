const { createGame, processMove, passTurn, hasMovesLeft, undoMove } = require('./gameLogic');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_dots_key';

const verifyUser = (token) => {
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch(e) { return null; }
};

const rooms = {}; // roomId -> roomData
const userRooms = {}; // socketId -> roomId
const matchmakingQueue = []; // array of player objects

const generateRoomCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const createRoom = (socket, io, data) => {
  const { nickname, settings, token } = data;
  const roomId = generateRoomCode();
  const user = verifyUser(token);
  const actualNickname = user ? user.username : nickname;
  
  rooms[roomId] = {
    id: roomId,
    players: [{ id: socket.id, nickname: actualNickname, color: settings.color || 'blue', ready: true, userId: user ? user.userId : null, isGuest: !user }],
    settings: {
      boardSize: settings.boardSize || 20,
      pieceStyle: settings.pieceStyle || 'dots',
    },
    status: 'waiting', // waiting, playing, finished
    game: null,
    timers: {},
    chat: [],
  };

  userRooms[socket.id] = roomId;
  socket.join(roomId);
  
  socket.emit('room_created', rooms[roomId]);
};

const createBotRoom = (socket, io, data) => {
  const { nickname, settings, token } = data;
  const roomId = generateRoomCode();
  const user = verifyUser(token);
  const actualNickname = user ? user.username : nickname;
  
  const botPlayer = { 
    id: 'bot-' + Date.now(), 
    nickname: 'DotMaster Bot', 
    color: settings.color === 'blue' ? 'red' : 'blue', 
    ready: true,
    isBot: true
  };

  rooms[roomId] = {
    id: roomId,
    players: [
      { id: socket.id, nickname: actualNickname, color: settings.color || 'blue', ready: true, userId: user ? user.userId : null, isGuest: !user },
      botPlayer
    ],
    settings: {
      boardSize: settings.boardSize || 20,
      pieceStyle: settings.pieceStyle || 'dots',
    },
    status: 'playing',
    game: null,
    timers: {},
    chat: [],
  };

  userRooms[socket.id] = roomId;
  socket.join(roomId);
  
  socket.emit('room_created', rooms[roomId]);
  
  // Start the game immediately since bot is already here
  startGame(roomId, io);
};

const joinRoom = (socket, io, data) => {
  const { nickname, roomId, color, token } = data;
  const user = verifyUser(token);
  const actualNickname = user ? user.username : nickname;
  const room = rooms[roomId];

  if (!room) {
    socket.emit('error', { message: 'Room not found' });
    return;
  }

  if (room.players.length >= 2) {
    socket.emit('error', { message: 'Room is full' });
    return;
  }

  const existingPlayerIndex = room.players.findIndex(p => p.nickname === nickname);
  
  if (existingPlayerIndex !== -1) {
    // Reconnection or moving from Lobby to Room with same socket
    room.players[existingPlayerIndex].id = socket.id;
    userRooms[socket.id] = roomId;
    socket.join(roomId);
    socket.emit('room_joined', room);
    io.to(roomId).emit('player_reconnected', room.players[existingPlayerIndex]);
    return;
  }

  const pColor = color || (room.players[0].color === 'blue' ? 'red' : 'blue');
  
  const newPlayer = { id: socket.id, nickname: actualNickname, color: pColor, ready: true, userId: user ? user.userId : null, isGuest: !user };
  room.players.push(newPlayer);
  userRooms[socket.id] = roomId;
  socket.join(roomId);
  
  socket.emit('room_joined', room);
  io.to(roomId).emit('player_joined', newPlayer);

  // Auto start when 2 players
  if (room.players.length === 2) {
    startGame(roomId, io);
  }
};

const findMatch = (socket, io, data) => {
  const { nickname, settings, token } = data;
  const user = verifyUser(token);
  const actualNickname = user ? user.username : nickname;

  // Remove existing if any
  const existingIdx = matchmakingQueue.findIndex(p => p.socket.id === socket.id || (user && p.data.userId === user.userId));
  if (existingIdx !== -1) matchmakingQueue.splice(existingIdx, 1);

  const playerObj = {
    socket,
    data: { nickname: actualNickname, settings: settings || {}, token, userId: user ? user.userId : null }
  };

  if (matchmakingQueue.length > 0) {
    // Found match!
    const opponent = matchmakingQueue.shift();
    const roomId = generateRoomCode();
    
    rooms[roomId] = {
      id: roomId,
      players: [
        { id: opponent.socket.id, nickname: opponent.data.nickname, color: 'blue', ready: true, userId: opponent.data.userId, isGuest: !opponent.data.userId },
        { id: socket.id, nickname: actualNickname, color: 'red', ready: true, userId: playerObj.data.userId, isGuest: !playerObj.data.userId }
      ],
      settings: {
        boardSize: 20,
        pieceStyle: 'dots'
      },
      status: 'playing',
      game: null,
      timers: {},
      chat: []
    };

    userRooms[opponent.socket.id] = roomId;
    userRooms[socket.id] = roomId;
    
    opponent.socket.join(roomId);
    socket.join(roomId);

    opponent.socket.emit('match_found', rooms[roomId]);
    socket.emit('match_found', rooms[roomId]);
    
    startGame(roomId, io);
  } else {
    // Wait in queue
    matchmakingQueue.push(playerObj);
    socket.emit('matchmaking_queued');
  }
};

const cancelMatch = (socket) => {
  const idx = matchmakingQueue.findIndex(p => p.socket.id === socket.id);
  if (idx !== -1) {
    matchmakingQueue.splice(idx, 1);
    socket.emit('matchmaking_cancelled');
  }
};

const getRoom = (socket, io, data) => {
  const { roomId, nickname, token } = data || {};
  const room = rooms[roomId];
  if (!room) {
    socket.emit('error', { message: 'Room not found' });
    return;
  }

  const user = verifyUser(token);
  const actualNickname = user ? user.username : nickname;

  // Re-link player ID if they refreshed
  if (actualNickname) {
    const existingPlayerIndex = room.players.findIndex(p => p.nickname === actualNickname || (user && p.userId === user.userId));
    if (existingPlayerIndex !== -1) {
      const wasDisconnected = room.players[existingPlayerIndex].id === null;
      room.players[existingPlayerIndex].id = socket.id;
      if (wasDisconnected && room.status === 'playing') {
        // Clear the 60s disconnect timeout so game doesn't end
        if (activeTimeouts[roomId]) {
          clearTimeout(activeTimeouts[roomId]);
          delete activeTimeouts[roomId];
        }
        io.to(roomId).emit('player_reconnected', room.players[existingPlayerIndex]);
        // If it's bot's turn, re-trigger it
        if (room.game) {
          const currentPlayer = room.players[room.game.turn];
          if (currentPlayer && currentPlayer.isBot) {
            setTimeout(() => handleBotMove(roomId, io, room.game.turn), 1500);
          }
        }
      }
    }
  }

  // Ensure user is in socket group
  socket.join(roomId);
  userRooms[socket.id] = roomId;

  socket.emit('room_joined', room);
};

const checkActiveGame = (socket, data) => {
  const { nickname, token } = data || {};
  const user = verifyUser(token);
  const actualNickname = user ? user.username : nickname;
  
  if (!actualNickname) return;

  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.status === 'playing' || room.status === 'waiting') {
      const isPlayer = room.players.some(p => {
        if (p.nickname === actualNickname) return true;
        if (user && p.userId === user.userId) return true;
        return false;
      });
      if (isPlayer) {
        socket.emit('active_game_found', roomId);
        return;
      }
    }
  }
};

const UNDO_COST = 1; // bonuses per undo
const WIN_BONUS_REWARD = 3; // bonuses awarded per win

const startGame = async (roomId, io) => {
  const room = rooms[roomId];
  room.status = 'playing';
  room.startedAt = Date.now();

  // Load bonus counts for registered players
  const prisma = require('./prisma/db');
  for (const player of room.players) {
    if (player.userId && !player.isBot) {
      try {
        const userData = await prisma.user.findUnique({ where: { id: player.userId }, select: { bonuses: true } });
        player.bonuses = userData?.bonuses ?? 0;
      } catch (e) { player.bonuses = 0; }
    } else {
      player.bonuses = player.bonuses ?? 0;
    }
  }

  // Dice roll to determine who goes first
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  const firstPlayer = d1 >= d2 ? 0 : 1;

  room.game = createGame(room.settings.boardSize, room.players, firstPlayer);

  io.to(roomId).emit('game_start', {
    ...room.game,
    players: room.players,
    diceResult: { dice: [d1, d2], firstPlayer }
  });

  // If the bot goes first, trigger its move after the dice animation
  const firstPlayerObj = room.players[firstPlayer];
  if (firstPlayerObj && firstPlayerObj.isBot) {
    setTimeout(() => handleBotMove(roomId, io, firstPlayer), 2500);
  }
};

const handleMove = (socket, io, data) => {
  const { x, y } = data;
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];

  if (!room || room.status !== 'playing') return;

  const game = room.game;
  const playerIndex = room.players.findIndex(p => p.id === socket.id);
  
  // Is it this player's turn?
  if (game.turn !== playerIndex) return;

  const { getPatternKey } = require('./botAI');
  const patternKey = getPatternKey(game.board, x, y, game.boardSize);
  const result = processMove(game, x, y, playerIndex, patternKey);
  
  if (result.success) {
    const nextPlayerIndex = game.turn;
    
    // First emit the move
    io.to(roomId).emit('move_made', {
      x, y, 
      playerIndex: playerIndex,
      nextTurn: nextPlayerIndex
    });

    if (result.captures && result.captures.length > 0) {
      // Find territories and captured points
      io.to(roomId).emit('territory_captured', {
        playerIndex: playerIndex,
        captures: result.captures,
        territories: result.territories, // array of enclosed areas
        score: game.score
      });
    }

    // Check game over
    if (!hasMovesLeft(game) || game.passes >= 2) {
      endGame(roomId, io, 'board_full');
    } else {
      // If it's a bot's turn, trigger it
      const nextPlayer = room.players[nextPlayerIndex];
      if (nextPlayer.isBot) {
        setTimeout(() => {
          handleBotMove(roomId, io, nextPlayerIndex);
        }, 1000);
      }
    }
  }
};

const handleBotMove = (roomId, io, playerIndex) => {
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  const game = room.game;
  const { getBotMove } = require('./botAI');

  let move;
  try {
    move = getBotMove(game, playerIndex);
  } catch (err) {
    console.error('Bot move error:', err);
    move = null;
  }

  if (move) {
     const result = processMove(game, move.x, move.y, playerIndex, move.patternKey);
     if (result.success) {
        const nextPlayerIndex = game.turn;
        
        io.to(roomId).emit('move_made', {
          x: move.x,
          y: move.y,
          playerIndex: playerIndex,
          nextTurn: nextPlayerIndex
        });

        if (result.captures && result.captures.length > 0) {
          io.to(roomId).emit('territory_captured', {
            playerIndex: playerIndex,
            captures: result.captures,
            territories: result.territories,
            score: game.score
          });
        }

        if (!hasMovesLeft(game) || game.passes >= 2) {
          endGame(roomId, io, 'board_full');
        }
     }
  } else {
    // If bot has no moves, it passes
    passTurn(game);
    io.to(roomId).emit('turn_passed', {
      playerIndex: playerIndex,
      nextTurn: game.turn
    });
    if (game.passes >= 2) endGame(roomId, io, 'double_pass');
  }
};

const handlePass = (socket, io, data) => {
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  const game = room.game;
  const playerIndex = room.players.findIndex(p => p.id === socket.id);
  
  if (game.turn !== playerIndex) return;

  passTurn(game);
  
  io.to(roomId).emit('turn_passed', {
    playerIndex: playerIndex,
    nextTurn: game.turn
  });

  if (game.passes >= 2) {
    endGame(roomId, io, 'double_pass');
  } else {
    const nextPlayer = room.players[game.turn];
    if (nextPlayer && nextPlayer.isBot) {
      setTimeout(() => handleBotMove(roomId, io, game.turn), 1000);
    }
  }
};

const handleDrawOffer = (socket, io) => {
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  const playerIndex = room.players.findIndex(p => p.id === socket.id);
  if (playerIndex === -1) return;
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const opponent = room.players[opponentIndex];

  if (opponent && opponent.isBot) {
    // Bot decides: accept if losing or tied, decline if winning by 2+
    const botScore = room.game.score[opponentIndex];
    const humanScore = room.game.score[playerIndex];
    setTimeout(() => {
      if (!rooms[roomId] || rooms[roomId].status !== 'playing') return;
      if (botScore - humanScore >= 2) {
        io.to(roomId).emit('draw_declined');
      } else {
        endGame(roomId, io, 'draw');
      }
    }, 1000);
  } else {
    socket.to(roomId).emit('draw_offered', { fromNickname: room.players[playerIndex].nickname });
  }
};

const handleDrawAccept = (socket, io) => {
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  endGame(roomId, io, 'draw');
};

const handleDrawDecline = (socket, io) => {
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  io.to(roomId).emit('draw_declined');
};

const handleResign = (socket, io) => {
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  const playerIndex = room.players.findIndex(p => p.id === socket.id);
  const winnerIndex = playerIndex === 0 ? 1 : 0;
  
  endGame(roomId, io, 'resign', winnerIndex);
};

const handleMessage = (socket, io, data) => {
  const { text } = data;
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];
  if (!room) return;

  const player = room.players.find(p => p.id === socket.id);
  const message = {
    id: Date.now(),
    text,
    sender: player ? player.nickname : 'Spectator',
    time: new Date().toISOString()
  };

  room.chat.push(message);
  io.to(roomId).emit('chat_message', message);
};

const activeTimeouts = {};

const handleDisconnect = (socket, io) => {
  const roomId = userRooms[socket.id];
  if (!roomId) return;

  const room = rooms[roomId];
  if (room) {
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.id = null; // Mark as disconnected
      
      io.to(roomId).emit('opponent_disconnected', {
        nickname: player.nickname,
        timeout: 60
      });

      // Start 60s timeout for technical defeat
      if (room.status === 'playing') {
        activeTimeouts[roomId] = setTimeout(() => {
          const roomCheck = rooms[roomId];
          if (roomCheck && roomCheck.status === 'playing') {
            const disconnectedPlayerIndex = roomCheck.players.findIndex(p => p.nickname === player.nickname);
            const winnerIndex = disconnectedPlayerIndex === 0 ? 1 : 0;
            endGame(roomId, io, 'timeout', winnerIndex);
          }
        }, 60000);
      }
    }
  }
  cancelMatch(socket);
  delete userRooms[socket.id];
};

const endGame = (roomId, io, reason, winnerIndex = null) => {
  const room = rooms[roomId];
  room.status = 'finished';

  const duration = room.startedAt ? Math.floor((Date.now() - room.startedAt) / 1000) : 0;

  let winner = null;
  if (winnerIndex !== null) {
    winner = winnerIndex;
  } else if (reason !== 'draw') {
    if (room.game.score[0] > room.game.score[1]) winner = 0;
    else if (room.game.score[1] > room.game.score[0]) winner = 1;
  }

  io.to(roomId).emit('game_over', {
    reason,
    winnerIndex: winner,
    score: room.game.score,
    duration,
    roomId
  });

  // DB update
  try {
    const prisma = require('./prisma/db');
    const p1 = room.players[0];
    const p2 = room.players[1] || { nickname: 'Unknown' };

    // Save game record for sharing (includes final board snapshot)
    prisma.gameRecord.create({
      data: {
        roomId,
        player1: p1.nickname,
        player2: p2.nickname,
        score1: room.game.score[0],
        score2: room.game.score[1],
        winnerIndex: winner,
        reason,
        duration,
        startedAt: new Date(room.startedAt || Date.now()),
        boardState: room.game.board
      }
    }).catch(console.error);

    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      if (p.isBot || !p.userId) continue;

      const statsUpdate = { totalGames: { increment: 1 }, timePlayed: { increment: duration } };

      if (winner === null) {
        statsUpdate.draws = { increment: 1 };
      } else if (winner === i) {
        statsUpdate.wins = { increment: 1 };
        statsUpdate.rating = { increment: 15 };
        statsUpdate.bonuses = { increment: WIN_BONUS_REWARD };
      } else {
        statsUpdate.losses = { increment: 1 };
        statsUpdate.rating = { decrement: 10 };
      }

      prisma.user.update({ where: { id: p.userId }, data: statsUpdate }).then(updated => {
        // Notify winner of their new bonus balance via socket
        if (winner === i && room.players[i]?.id) {
          io.to(room.players[i].id).emit('bonuses_updated', { bonuses: updated.bonuses });
        }
      }).catch(e => {
        if (e.code !== 'P2025') console.error('DB update err', e);
      });
    }
  } catch(e) { console.error('DB update err', e); }

  // BOT LEARNING
  const botIndex = room.players.findIndex(p => p.isBot);
  if (botIndex !== -1 && room.game) {
    const { updatePatternsFromGame } = require('./botAI');
    updatePatternsFromGame(room.game.history, winner, botIndex);
  }
  
  if (activeTimeouts[roomId]) {
    clearTimeout(activeTimeouts[roomId]);
    delete activeTimeouts[roomId];
  }
};

const handleUndoMove = async (socket, io) => {
  const roomId = userRooms[socket.id];
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  const playerIndex = room.players.findIndex(p => p.id === socket.id);
  if (playerIndex === -1) return;

  // Can only undo on your turn
  if (room.game.turn !== playerIndex) {
    socket.emit('error', { message: 'Not your turn' });
    return;
  }

  // Need at least 1 history entry (player's own last move)
  if (room.game.history.length === 0) {
    socket.emit('undo_denied', { reason: 'no_history' });
    return;
  }

  const player = room.players[playerIndex];
  const prisma = require('./prisma/db');

  // Check and deduct bonuses
  if (player.userId) {
    try {
      const userData = await prisma.user.findUnique({ where: { id: player.userId }, select: { bonuses: true } });
      if (!userData || userData.bonuses < UNDO_COST) {
        socket.emit('undo_denied', { reason: 'no_bonuses' });
        return;
      }
      await prisma.user.update({ where: { id: player.userId }, data: { bonuses: { decrement: UNDO_COST } } });
      player.bonuses = userData.bonuses - UNDO_COST;
    } catch (e) {
      socket.emit('undo_denied', { reason: 'error' });
      return;
    }
  } else {
    // Guest
    if ((player.bonuses || 0) < UNDO_COST) {
      socket.emit('undo_denied', { reason: 'no_bonuses' });
      return;
    }
    player.bonuses = (player.bonuses || 0) - UNDO_COST;
  }

  // Undo the last move (opponent's or bot's move that just happened)
  undoMove(room.game);

  // In bot games: if we undid the bot's move and now it's the bot's turn again,
  // also undo the player's preceding move so the player gets their turn back
  const hasBotOpponent = room.players.some(p => p.isBot);
  if (hasBotOpponent && room.game.history.length > 0 && room.game.turn !== playerIndex) {
    undoMove(room.game);
  }
  // Also handle the edge case where it was the very first human move
  if (!hasBotOpponent && room.game.history.length > 0) {
    // In pvp: also undo one more so the requestor gets their turn back
    const lastEntry = room.game.history[room.game.history.length - 1];
    if (lastEntry.playerIndex === playerIndex) {
      undoMove(room.game);
    }
  }

  io.to(roomId).emit('move_undone', {
    board: room.game.board,
    score: room.game.score,
    turn: room.game.turn,
  });

  socket.emit('bonuses_updated', { bonuses: player.bonuses });
};

module.exports = {
  createRoom,
  joinRoom,
  handleMove,
  handlePass,
  handleDrawOffer,
  handleDrawAccept,
  handleDrawDecline,
  handleUndoMove,
  handleResign,
  handleMessage,
  handleDisconnect,
  getRoom,
  createBotRoom,
  findMatch,
  cancelMatch,
  checkActiveGame
};
