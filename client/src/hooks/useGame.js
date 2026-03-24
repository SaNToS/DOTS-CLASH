import { useState, useEffect, useCallback, useRef } from 'react';

export const useGame = (socket, roomId, myNickname) => {
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [chat, setChat] = useState([]);
  const [gameOverResult, setGameOverResult] = useState(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(null);
  const [lastCaptureAt, setLastCaptureAt] = useState(0);
  const [diceRoll, setDiceRoll] = useState(null);
  const [playerTimes, setPlayerTimes] = useState([0, 0]);
  const turnStartRef = useRef(null);

  // Draw offer states
  const [drawOffered, setDrawOffered] = useState(null);
  const [drawOfferSent, setDrawOfferSent] = useState(false);
  const [drawDeclined, setDrawDeclined] = useState(false);

  // Undo / bonus states
  const [bonuses, setBonuses] = useState(0);
  const [undoDenied, setUndoDenied] = useState(null); // 'no_bonuses' | 'no_history' | null

  useEffect(() => {
    if (!socket) return;

    if (socket.connected && !room) {
      const token = localStorage.getItem('dots_token');
      socket.emit('get_room', { nickname: myNickname, roomId, token });
    }

    socket.on('room_joined', (roomData) => {
      setRoom(roomData);
      if (roomData.status === 'playing' || roomData.status === 'finished') {
        setGameState(roomData.game);
      }
      setChat(roomData.chat || []);
    });

    socket.on('game_start', (gameData) => {
      if (gameData.diceResult) setDiceRoll(gameData.diceResult);
      turnStartRef.current = Date.now();
      setPlayerTimes([0, 0]);
      setGameState(gameData);
      setGameOverResult(null);
      setDrawOffered(null);
      setDrawOfferSent(false);
      setDrawDeclined(false);
      setUndoDenied(null);

      // Set initial bonus count from player data
      if (gameData.players) {
        const me = gameData.players.find(p => p.nickname === myNickname);
        if (me) setBonuses(me.bonuses ?? 0);
      }

      setRoom(prev => {
        if (!prev) return null;
        return { ...prev, status: 'playing', players: gameData.players };
      });
    });

    socket.on('move_made', (data) => {
      if (turnStartRef.current !== null) {
        const elapsed = Math.floor((Date.now() - turnStartRef.current) / 1000);
        setPlayerTimes(prev => {
          const next = [...prev];
          next[data.playerIndex] += elapsed;
          return next;
        });
      }
      turnStartRef.current = Date.now();

      setGameState(prev => {
        if (!prev) return prev;
        const newBoard = prev.board.map(row => [...row]);
        newBoard[data.y][data.x] = data.playerIndex + 1;
        return {
          ...prev,
          board: newBoard,
          turn: data.nextTurn,
          passes: 0,
          lastMove: { x: data.x, y: data.y }
        };
      });
    });

    socket.on('territory_captured', (data) => {
      setGameState(prev => {
        if (!prev) return prev;
        const newBoard = prev.board.map(row => [...row]);
        const p_terr = data.playerIndex === 0 ? 3 : 4;
        data.territories.forEach(area => {
          area.forEach(cell => {
            if (newBoard[cell.y][cell.x] !== (data.playerIndex + 1)) {
              newBoard[cell.y][cell.x] = p_terr;
            }
          });
        });
        return { ...prev, board: newBoard, score: data.score };
      });
      setLastCaptureAt({ time: Date.now(), playerIndex: data.playerIndex });
    });

    socket.on('turn_passed', (data) => {
      if (turnStartRef.current !== null) {
        const elapsed = Math.floor((Date.now() - turnStartRef.current) / 1000);
        setPlayerTimes(prev => {
          const next = [...prev];
          const passer = data.nextTurn === 0 ? 1 : 0;
          next[passer] += elapsed;
          return next;
        });
      }
      turnStartRef.current = Date.now();
      setGameState(prev => prev ? { ...prev, turn: data.nextTurn, passes: prev.passes + 1 } : prev);
    });

    socket.on('move_undone', (data) => {
      turnStartRef.current = Date.now();
      setGameState(prev => prev ? {
        ...prev,
        board: data.board,
        score: data.score,
        turn: data.turn,
        lastMove: null,
      } : prev);
    });

    socket.on('bonuses_updated', (data) => {
      setBonuses(data.bonuses);
    });

    socket.on('undo_denied', (data) => {
      setUndoDenied(data.reason);
      setTimeout(() => setUndoDenied(null), 3000);
    });

    socket.on('game_over', (data) => {
      setGameOverResult(data);
      setRoom(prev => prev ? { ...prev, status: 'finished' } : prev);
      setDrawOffered(null);
      setDrawOfferSent(false);
    });

    socket.on('player_joined', (player) => {
      setRoom(prev => prev ? { ...prev, players: [...prev.players, player] } : prev);
    });

    socket.on('player_reconnected', (player) => {
      setRoom(prev => {
        if (!prev) return prev;
        const newPlayers = prev.players.map(p => p.nickname === player.nickname ? player : p);
        return { ...prev, players: newPlayers };
      });
      setOpponentDisconnected(null);
    });

    socket.on('opponent_disconnected', (info) => {
      setOpponentDisconnected(info);
    });

    socket.on('chat_message', (msg) => {
      setChat(prev => [...prev, msg]);
    });

    socket.on('draw_offered', (data) => {
      setDrawOffered(data);
    });

    socket.on('draw_declined', () => {
      setDrawOffered(null);
      setDrawOfferSent(false);
      setDrawDeclined(true);
      setTimeout(() => setDrawDeclined(false), 3000);
    });

    socket.on('error', (err) => {
      setError(err.message);
    });

    const handleConnect = () => {
      const token = localStorage.getItem('dots_token');
      socket.emit('get_room', { nickname: myNickname, roomId, token });
    };
    socket.on('connect', handleConnect);

    return () => {
      socket.off('room_joined');
      socket.off('game_start');
      socket.off('move_made');
      socket.off('territory_captured');
      socket.off('turn_passed');
      socket.off('move_undone');
      socket.off('bonuses_updated');
      socket.off('undo_denied');
      socket.off('game_over');
      socket.off('player_joined');
      socket.off('player_reconnected');
      socket.off('opponent_disconnected');
      socket.off('chat_message');
      socket.off('draw_offered');
      socket.off('draw_declined');
      socket.off('error');
      socket.off('connect', handleConnect);
    };
  }, [socket, roomId, myNickname]);

  const makeMove = useCallback((x, y) => {
    if (socket) socket.emit('make_move', { x, y });
  }, [socket]);

  const passTurn = useCallback(() => {
    if (socket) socket.emit('pass_turn');
  }, [socket]);

  const resign = useCallback(() => {
    if (socket) socket.emit('resign');
  }, [socket]);

  const sendMessage = useCallback((text) => {
    if (socket) socket.emit('send_message', { text });
  }, [socket]);

  const offerDraw = useCallback(() => {
    if (socket) {
      socket.emit('offer_draw');
      setDrawOfferSent(true);
    }
  }, [socket]);

  const acceptDraw = useCallback(() => {
    if (socket) {
      socket.emit('accept_draw');
      setDrawOffered(null);
    }
  }, [socket]);

  const declineDraw = useCallback(() => {
    if (socket) {
      socket.emit('decline_draw');
      setDrawOffered(null);
    }
  }, [socket]);

  const undoMove = useCallback(() => {
    if (socket) socket.emit('undo_move');
  }, [socket]);

  return {
    room, gameState, error, chat, gameOverResult,
    opponentDisconnected, lastCaptureAt, diceRoll,
    playerTimes, turnStartRef,
    drawOffered, drawOfferSent, drawDeclined,
    bonuses, undoDenied,
    makeMove, passTurn, resign, sendMessage,
    offerDraw, acceptDraw, declineDraw,
    undoMove,
  };
};
