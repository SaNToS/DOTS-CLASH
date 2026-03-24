import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { useGame } from '../hooks/useGame';
import GameBoard from './GameBoard';
import { useAudio } from '../hooks/useAudio';
import { useLanguage } from '../context/LanguageContext';
import { Send, Flag, Check, RotateCcw, AlertTriangle, Volume2, VolumeX, Music, Copy, Share2, Clock, Handshake, Undo2, Gem, X, MessageSquare, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── helpers ──────────────────────────────────────────────────── */
const fmtTime = (secs) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const DICE_DOTS = {
  1: [[1,1]],
  2: [[0,0],[2,2]],
  3: [[0,0],[1,1],[2,2]],
  4: [[0,0],[0,2],[2,0],[2,2]],
  5: [[0,0],[0,2],[1,1],[2,0],[2,2]],
  6: [[0,0],[0,2],[1,0],[1,2],[2,0],[2,2]],
};

function DieFace({ value, rolling }) {
  const show = rolling ? Math.ceil(Math.random() * 6) : value;
  return (
    <div className="w-16 h-16 bg-white rounded-xl shadow-lg relative flex items-center justify-center">
      <div className="grid grid-cols-3 grid-rows-3 w-12 h-12 gap-1">
        {Array.from({ length: 9 }).map((_, i) => {
          const row = Math.floor(i / 3);
          const col = i % 3;
          const hasDot = (DICE_DOTS[show] || []).some(([r, c]) => r === row && c === col);
          return (
            <div key={i} className="flex items-center justify-center">
              {hasDot && <div className="w-2.5 h-2.5 bg-slate-900 rounded-full" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Confetti ──────────────────────────────────────────────────── */
const COLORS = ['#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#ec4899','#14b8a6'];
function Confetti() {
  const pieces = useRef(
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 2}s`,
      duration: `${2 + Math.random() * 2}s`,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: `${6 + Math.random() * 8}px`,
    }))
  ).current;

  return (
    <>
      {pieces.map(p => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            top: '-10px',
            animationDelay: p.delay,
            animationDuration: p.duration,
            backgroundColor: p.color,
            width: p.size,
            height: p.size,
          }}
        />
      ))}
    </>
  );
}

/* ─── Animated background canvas ────────────────────────────────── */
function ParticleBackground() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const N = 35;
    const particles = Array.from({ length: N }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: 2 + Math.random() * 2,
      hue: 200 + Math.random() * 60,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 65%, 0.6)`;
        ctx.fill();
      });

      // Draw connecting lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(99, 179, 237, ${0.15 * (1 - dist / 120)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none rounded-3xl opacity-40"
    />
  );
}

/* ─── Move timer ─────────────────────────────────────────────────── */
function TurnTimer({ turnStartRef, isActive }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive || !turnStartRef.current) { setElapsed(0); return; }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - turnStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isActive, turnStartRef]);

  useEffect(() => { setElapsed(0); }, [isActive]);

  return (
    <span className={`font-mono text-sm font-bold tabular-nums ${elapsed > 30 ? 'text-red-400' : 'text-slate-300'}`}>
      {fmtTime(elapsed)}
    </span>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */
export default function GameRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const nickname = location.state?.nickname || sessionStorage.getItem('nickname') || '';
  const { t } = useLanguage();

  const { socket, isConnected } = useSocket();
  const {
    room, gameState, chat, gameOverResult, opponentDisconnected,
    lastCaptureAt, diceRoll, playerTimes, turnStartRef,
    drawOffered, drawOfferSent, drawDeclined,
    bonuses, undoDenied,
    makeMove, passTurn, resign, sendMessage,
    offerDraw, acceptDraw, declineDraw,
    undoMove,
  } = useGame(socket, roomId, nickname);

  const {
    playPopSound, playCaptureSound, playVictoryFanfare,
    playDiceRollSound, playDiceRevealSound,
    isMuted, toggleMute, isMusicPlaying, toggleMusic
  } = useAudio();

  const [chatMessage, setChatMessage] = useState('');
  const chatEndRef = useRef(null);
  const [showRules, setShowRules] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [flashCapture, setFlashCapture] = useState(null);

  // Dice modal state
  const [showDice, setShowDice] = useState(false);
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceValues, setDiceValues] = useState([1, 1]);
  const diceShownRef = useRef(false);

  // Victory share state
  const [copied, setCopied] = useState(false);

  // Bonus shop state
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);

  const handleBuyBonus = async (pack) => {
    const token = localStorage.getItem('dots_token');
    if (!token) return;
    setBuyLoading(pack);
    try {
      const HOST = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;
      const res = await fetch(`${HOST}/api/auth/bonuses/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pack }),
      });
      if (res.ok) {
        const data = await res.json();
        // bonuses state is managed by socket events; optimistically update via refetch is not needed
        // The server doesn't emit bonuses_updated on purchase, so just close modal
        // We re-fetch on next game start; for now show a quick feedback
        setShowBonusModal(false);
      }
    } catch (e) { /* ignore */ }
    finally { setBuyLoading(false); }
  };

  const myPlayerIndex = room ? room.players.findIndex(p => p.nickname === nickname) : -1;

  // Trigger capture flash & sound
  useEffect(() => {
    if (lastCaptureAt?.time > 0 && myPlayerIndex !== -1) {
      const byMe = lastCaptureAt.playerIndex === myPlayerIndex;
      playCaptureSound(byMe);
      setFlashCapture(byMe ? 'green' : 'red');
      const t = setTimeout(() => setFlashCapture(null), 800);
      return () => clearTimeout(t);
    }
  }, [lastCaptureAt, myPlayerIndex, playCaptureSound]);

  // Dice animation when game starts
  useEffect(() => {
    if (!diceRoll || diceShownRef.current) return;
    diceShownRef.current = true;
    setDiceValues([diceRoll.dice[0], diceRoll.dice[1]]);
    setShowDice(true);
    setDiceRolling(true);
    playDiceRollSound();

    // Settle the dice after animation
    const settleTimer = setTimeout(() => {
      setDiceRolling(false);
      playDiceRevealSound();
    }, 1800);

    // Auto-hide after reveal
    const hideTimer = setTimeout(() => setShowDice(false), 4000);

    return () => { clearTimeout(settleTimer); clearTimeout(hideTimer); };
  }, [diceRoll, playDiceRollSound, playDiceRevealSound]);

  // Victory fanfare
  const fanfarePlayed = useRef(false);
  useEffect(() => {
    if (gameOverResult && gameOverResult.winnerIndex === myPlayerIndex && !fanfarePlayed.current) {
      fanfarePlayed.current = true;
      playVictoryFanfare();
    }
  }, [gameOverResult, myPlayerIndex, playVictoryFanfare]);

  // Save nickname
  useEffect(() => {
    if (nickname) {
      sessionStorage.setItem('nickname', nickname);
    } else {
      navigate('/');
    }
  }, [nickname, navigate]);

  useEffect(() => {
    if (chat.length === 0) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (!showMobileChat) {
      setUnreadCount(n => n + 1);
    }
  }, [chat]); // eslint-disable-line react-hooks/exhaustive-deps

  const openMobileChat = () => {
    setShowMobileChat(true);
    setUnreadCount(0);
  };

  const handleShareCopy = useCallback(() => {
    navigator.clipboard.writeText(`${window.location.origin}/game/${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center p-10">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <span className="text-slate-300 font-medium">{t('game.connecting')}</span>
      </div>
    );
  }

  if (!room || !room.settings) {
    return (
      <div className="flex flex-col items-center justify-center p-10">
        <span className="text-slate-300 font-medium">{t('game.loading')}</span>
      </div>
    );
  }

  const isMyTurn = gameState && gameState.turn === myPlayerIndex;
  const gameResultLink = `${window.location.origin}/game/${roomId}`;
  const shareText = gameOverResult
    ? `Dots Clash: ${room.players[0]?.nickname} vs ${room.players[1]?.nickname} — ${gameOverResult.score?.[0]}:${gameOverResult.score?.[1]}`
    : '';

  const handleSendChat = (e) => {
    e.preventDefault();
    if (chatMessage.trim()) { sendMessage(chatMessage); setChatMessage(''); }
  };

  const canOfferDraw = room.status === 'playing' && !drawOfferSent && !drawOffered && myPlayerIndex !== -1;

  return (
    <>
      {/* Confetti on win */}
      {gameOverResult?.winnerIndex === myPlayerIndex && <Confetti />}

      {/* Full-screen capture flash */}
      <div
        className="fixed inset-0 z-0 pointer-events-none transition-opacity duration-300"
        style={{ opacity: flashCapture ? 1 : 0 }}
      >
        <div className={`absolute inset-0 transition-all duration-300 mix-blend-screen ${
          flashCapture === 'green'
            ? 'bg-[radial-gradient(ellipse_at_center,rgba(74,222,128,0.2),rgba(74,222,128,0.7))] shadow-[inset_0_0_500px_rgba(74,222,128,0.9)]'
            : flashCapture === 'red'
            ? 'bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.2),rgba(239,68,68,0.8))] shadow-[inset_0_0_500px_rgba(239,68,68,1)]'
            : 'bg-transparent'
        }`} />
      </div>

      {/* Dice roll modal */}
      <AnimatePresence>
        {showDice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.7, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-slate-800 border border-slate-600 rounded-3xl p-10 flex flex-col items-center gap-6 shadow-2xl"
            >
              <h2 className="text-2xl font-black text-white">{t('game.rolling')}</h2>
              <div className="flex gap-8">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase">{room.players[0]?.nickname}</span>
                  <DieFace value={diceValues[0]} rolling={diceRolling} />
                </div>
                <div className="flex items-center text-3xl font-black text-slate-500">vs</div>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase">{room.players[1]?.nickname}</span>
                  <DieFace value={diceValues[1]} rolling={diceRolling} />
                </div>
              </div>
              {!diceRolling && diceRoll && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-lg font-bold text-yellow-400"
                >
                  {t('game.goes_first', { name: room.players[diceRoll.firstPlayer]?.nickname })}
                </motion.p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buy Bonuses Modal */}
      <AnimatePresence>
        {showBonusModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md"
            onClick={() => setShowBonusModal(false)}
          >
            <motion.div
              initial={{ scale: 0.85, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-800 border border-slate-600 rounded-3xl p-8 flex flex-col gap-5 shadow-2xl w-full max-w-sm mx-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gem className="w-6 h-6 text-purple-400" />
                  <h2 className="text-xl font-black text-white">{t('bonus.title')}</h2>
                </div>
                <button onClick={() => setShowBonusModal(false)} className="text-slate-400 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-slate-400">{t('bonus.subtitle')}</p>

              <div className="flex items-center gap-2 bg-slate-900/60 rounded-xl px-4 py-3">
                <Gem className="w-4 h-4 text-purple-400" />
                <span className="text-white font-bold">{t('bonus.balance', { n: bonuses })}</span>
                <span className="text-slate-500 text-xs ml-auto">{t('bonus.earn', { n: 3 })}</span>
              </div>

              {!localStorage.getItem('dots_token') ? (
                <p className="text-center text-slate-500 text-sm">Log in to purchase bonuses.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {[
                    { pack: 'small', label: t('bonus.small'), price: '$0.99', color: 'slate' },
                    { pack: 'medium', label: t('bonus.medium'), price: '$2.99', color: 'blue' },
                    { pack: 'large', label: t('bonus.large'), price: '$5.99', color: 'purple' },
                  ].map(({ pack, label, price, color }) => (
                    <button
                      key={pack}
                      onClick={() => handleBuyBonus(pack)}
                      disabled={buyLoading === pack}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-60 ${
                        color === 'purple' ? 'bg-purple-600 hover:bg-purple-500 text-white' :
                        color === 'blue' ? 'bg-blue-600 hover:bg-blue-500 text-white' :
                        'bg-slate-700 hover:bg-slate-600 text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Gem className="w-4 h-4" />
                        {label}
                      </span>
                      <span className="text-sm opacity-80">{buyLoading === pack ? '...' : price}</span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.4 }}
        className={`w-full flex flex-row gap-2 md:gap-6 h-[calc(100vh-8rem)] max-md:h-[calc(100dvh-1rem)] relative z-10 transition-transform duration-100 ${
          flashCapture === 'red' ? 'scale-[0.98] translate-y-1 rotate-[0.5deg]' :
          flashCapture === 'green' ? 'scale-[1.015]' : ''
        }`}
      >

        {/* LEFT PANEL */}
        <div className="flex-1 flex flex-col min-w-[60%] max-md:min-w-0 bg-slate-800/80 rounded-3xl border border-slate-700 p-3 md:p-6 shadow-[0_0_40px_-15px_rgba(0,0,0,0.5)] relative backdrop-blur-xl overflow-hidden min-h-0">

          {/* Animated particle background (outside game board) */}
          <ParticleBackground />

          {/* Top Bar: Players, Score, Timers */}
          <div className="shrink-0 flex justify-between items-center mb-4 bg-gradient-to-r from-slate-900/80 via-slate-800/80 to-slate-900/80 p-3 md:p-4 max-md:p-2 max-md:mb-2 rounded-xl border border-slate-700 shadow-lg relative z-20">
            {/* Player 0 */}
            <div className={`flex items-center gap-3 max-md:gap-1.5 ${gameState?.turn === 0 ? 'ring-2 ring-white/20 p-2 rounded-lg bg-white/5' : 'p-2 max-md:p-1.5'}`}>
              <div className={`w-4 h-4 max-md:w-3 max-md:h-3 rounded-full shrink-0 ${room.players[0]?.color === 'red' ? 'bg-red-500' : 'bg-blue-500'}`} />
              <div>
                <div className="font-bold text-slate-200 text-sm max-md:text-xs max-md:truncate max-md:max-w-[70px]">
                  {room.players[0]?.nickname || 'Waiting...'}
                  {myPlayerIndex === 0 && <span className="text-xs text-slate-500 ml-1 max-md:hidden">({t('game.you')})</span>}
                </div>
                <div className="text-2xl font-black text-slate-100 max-md:text-xl">{gameState?.score[0] ?? 0}</div>
                <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5 max-md:text-[10px]">
                  <Clock className="w-3 h-3" />
                  <span>{fmtTime(playerTimes[0])}</span>
                  {gameState?.turn === 0 && gameState && room.status === 'playing' && (
                    <span className="text-slate-400">· <TurnTimer turnStartRef={turnStartRef} isActive={gameState?.turn === 0} /></span>
                  )}
                </div>
              </div>
            </div>

            {/* Center: room code + controls */}
            <div className="text-center flex flex-col items-center">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-2 max-md:gap-1.5">
                <span className="max-md:hidden">{t('game.room')}</span>
                <button onClick={toggleMute} className="text-slate-400 hover:text-white transition-colors" title="Toggle Sound">
                  {isMuted ? <VolumeX className="w-4 h-4 max-md:w-3.5 max-md:h-3.5" /> : <Volume2 className="w-4 h-4 max-md:w-3.5 max-md:h-3.5 text-green-400" />}
                </button>
                <button onClick={toggleMusic} className="text-slate-400 hover:text-white transition-colors" title="Ambient Music">
                  <Music className={`w-4 h-4 max-md:w-3.5 max-md:h-3.5 ${isMusicPlaying ? 'text-blue-400' : ''}`} />
                </button>
                <button onClick={() => setShowRules(!showRules)} className="text-slate-400 hover:text-yellow-400 transition-colors" title="Rules">
                  <div className="w-4 h-4 flex items-center justify-center font-black border-2 border-current rounded-full text-[9px]">?</div>
                </button>
              </div>
              <div className="text-xs md:text-base font-mono text-slate-300 bg-slate-900 px-3 py-1 max-md:px-2 max-md:py-0.5 max-md:text-[10px] rounded-lg border border-slate-600 select-all shadow-inner">
                {roomId}
              </div>
            </div>

            {/* Player 1 */}
            <div className={`flex items-center gap-3 max-md:gap-1.5 text-right ${gameState?.turn === 1 ? 'ring-2 ring-white/20 p-2 rounded-lg bg-white/5' : 'p-2 max-md:p-1.5'}`}>
              <div>
                <div className="font-bold text-slate-200 text-sm max-md:text-xs max-md:truncate max-md:max-w-[70px]">
                  {room.players[1]?.nickname || 'Waiting...'}
                  {myPlayerIndex === 1 && <span className="text-xs text-slate-500 ml-1 max-md:hidden">({t('game.you')})</span>}
                </div>
                <div className="text-2xl font-black text-slate-100 max-md:text-xl">{gameState?.score[1] ?? 0}</div>
                <div className="flex items-center justify-end gap-1 text-xs text-slate-500 mt-0.5 max-md:text-[10px]">
                  {gameState?.turn === 1 && gameState && room.status === 'playing' && (
                    <span className="text-slate-400"><TurnTimer turnStartRef={turnStartRef} isActive={gameState?.turn === 1} /> ·</span>
                  )}
                  <span>{fmtTime(playerTimes[1])}</span>
                  <Clock className="w-3 h-3" />
                </div>
              </div>
              <div className={`w-4 h-4 max-md:w-3 max-md:h-3 rounded-full shrink-0 ${room.players[1]?.color === 'red' ? 'bg-red-500' : 'bg-blue-500'}`} />
            </div>
          </div>

          {/* Game Board Area */}
          <div className={`flex-1 min-h-0 flex items-center justify-center relative rounded-2xl border overflow-hidden transition-all duration-500 delay-75 ${
            flashCapture === 'green' ? 'bg-green-900/40 border-green-500 shadow-[inset_0_0_80px_rgba(74,222,128,0.6)]' :
            flashCapture === 'red' ? 'bg-red-900/40 border-red-500 shadow-[inset_0_0_80px_rgba(239,68,68,0.6)]' :
            'bg-slate-900/30 border-slate-700/30'
          }`}>

            {/* Rules overlay */}
            {showRules && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-2 left-2 right-2 md:left-4 md:right-4 z-30 bg-slate-800/95 backdrop-blur-xl border border-blue-500/30 p-4 rounded-xl shadow-2xl"
              >
                <h4 className="font-bold text-blue-400 mb-2">{t('game.rules_title')}</h4>
                <ul className="text-xs md:text-sm text-slate-300 space-y-2 list-disc pl-4">
                  <li>{t('game.rule1')}</li>
                  <li>{t('game.rule2')}</li>
                  <li>{t('game.rule3')}</li>
                  <li>{t('game.rule4')}</li>
                  <li>{t('game.rule5')}</li>
                </ul>
                <button onClick={() => setShowRules(false)} className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-bold text-white transition-colors">{t('game.got_it')}</button>
              </motion.div>
            )}

            {/* Waiting overlay */}
            {room.status === 'waiting' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm rounded-2xl">
                <RotateCcw className="w-12 h-12 text-blue-400 mb-4 animate-spin-slow" />
                <h2 className="text-2xl font-bold text-white mb-2">{t('game.waiting')}</h2>
                <p className="text-slate-400">{t('game.share_code')} <span className="text-white font-mono bg-slate-800 px-2 py-1 rounded">{roomId}</span></p>
              </div>
            )}

            {/* Draw offer incoming banner */}
            <AnimatePresence>
              {drawOffered && room.status === 'playing' && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="absolute top-4 left-4 right-4 z-20 bg-slate-800/95 backdrop-blur-xl border border-blue-500/40 rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <Handshake className="w-5 h-5 text-blue-400 shrink-0" />
                    <span className="text-sm font-semibold text-white">
                      {t('game.draw_offer', { name: drawOffered.fromNickname })}
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={acceptDraw}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      {t('game.accept')}
                    </button>
                    <button
                      onClick={declineDraw}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg transition-colors"
                    >
                      {t('game.decline')}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Draw declined / undo denied notifications */}
            <AnimatePresence>
              {(drawDeclined || undoDenied) && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="absolute top-4 left-4 right-4 z-20 bg-orange-500/90 text-white px-4 py-3 rounded-2xl text-sm font-semibold text-center shadow-lg backdrop-blur-md"
                >
                  {drawDeclined ? t('game.draw_declined') :
                   undoDenied === 'no_bonuses' ? t('game.no_bonuses') :
                   t('game.no_history')}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Game over overlay */}
            {room.status === 'finished' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-md rounded-lg p-6 text-center overflow-y-auto"
              >
                {gameOverResult?.winnerIndex === myPlayerIndex ? (
                  <>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: [0, 1.3, 1] }}
                      transition={{ duration: 0.6, times: [0, 0.6, 1] }}
                      className="text-7xl mb-4"
                    >
                      🏆
                    </motion.div>
                    <h2 className="text-4xl font-black text-yellow-400 mb-2 uppercase tracking-wider drop-shadow-[0_0_20px_rgba(234,179,8,0.6)]">
                      {t('game.you_won')}
                    </h2>
                    <p className="text-slate-400 mb-1">{t('game.congrats')}</p>
                  </>
                ) : gameOverResult?.winnerIndex === null ? (
                  <>
                    <div className="text-5xl mb-4">🤝</div>
                    <h2 className="text-4xl font-black text-blue-400 mb-2">{t('game.draw')}</h2>
                  </>
                ) : (
                  <>
                    <div className="text-5xl mb-4">😔</div>
                    <h2 className="text-4xl font-black text-red-400 mb-2">{t('game.you_lost')}</h2>
                    <p className="text-slate-400 mb-1">{t('game.better_luck')}</p>
                  </>
                )}

                {gameOverResult?.reason === 'timeout' && (
                  <div className="text-orange-400 mb-2 flex items-center gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4" /> {t('game.opponent_abandoned')}
                  </div>
                )}

                <div className="text-2xl font-black text-white my-3">
                  {gameOverResult?.score?.[0] ?? 0} — {gameOverResult?.score?.[1] ?? 0}
                </div>

                {/* Social share */}
                <div className="mb-4 w-full max-w-xs">
                  <p className="text-xs text-slate-500 mb-2 flex items-center justify-center gap-1">
                    <Share2 className="w-3 h-3" /> {t('game.share')}
                  </p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    <button
                      onClick={handleShareCopy}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {copied ? t('game.copied') : t('game.copy_link')}
                    </button>
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(gameResultLink)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-medium transition-colors"
                    >
                      X / Twitter
                    </a>
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(gameResultLink)}&text=${encodeURIComponent(shareText)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium transition-colors"
                    >
                      Telegram
                    </a>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + gameResultLink)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-green-800 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                    >
                      WhatsApp
                    </a>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => navigate('/lobby')}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold transition-colors"
                  >
                    {t('game.play_again')}
                  </button>
                  <button
                    onClick={() => navigate('/')}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-bold transition-colors"
                  >
                    {t('game.return_lobby')}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Opponent disconnected banner */}
            {opponentDisconnected && room.status === 'playing' && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-orange-500/90 text-white px-6 py-3 rounded-full flex items-center gap-3 shadow-lg backdrop-blur-md">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-semibold">{t('game.opponent_disconnected', { name: opponentDisconnected.nickname })}</span>
              </div>
            )}

            <GameBoard
              boardSize={room.settings?.boardSize || 20}
              board={gameState?.board}
              myPlayerIndex={myPlayerIndex}
              turn={gameState?.turn}
              onMakeMove={makeMove}
              players={room.players}
              pieceStyle={room.settings?.pieceStyle || 'dots'}
              lastMove={gameState?.lastMove}
              playPopSound={playPopSound}
            />
          </div>

          {/* Action Controls */}
          <div className="shrink-0 mt-4 flex flex-col gap-2">
            <div className="flex justify-center gap-2 flex-wrap max-md:grid max-md:grid-cols-4 max-md:gap-1.5">
              <button
                onClick={passTurn}
                disabled={!isMyTurn || room.status !== 'playing'}
                className="flex-1 max-w-[110px] max-md:max-w-none flex justify-center items-center gap-1.5 max-md:flex-col max-md:gap-1 px-3 max-md:px-1 py-2.5 max-md:py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-lg active:scale-95 text-sm max-md:text-xs"
              >
                <Check className="w-4 h-4 shrink-0" /> <span>{t('game.pass')}</span>
              </button>
              <button
                onClick={undoMove}
                disabled={!isMyTurn || room.status !== 'playing'}
                className="flex-1 max-w-[110px] max-md:max-w-none flex justify-center items-center gap-1.5 max-md:flex-col max-md:gap-1 px-3 max-md:px-1 py-2.5 max-md:py-3 bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold transition-all shadow-lg active:scale-95 text-sm max-md:text-xs"
              >
                <Undo2 className="w-4 h-4 shrink-0" /> <span>{t('game.undo')}</span>
              </button>
              <button
                onClick={offerDraw}
                disabled={!canOfferDraw}
                className={`flex-1 max-w-[110px] max-md:max-w-none flex justify-center items-center gap-1.5 max-md:flex-col max-md:gap-1 px-3 max-md:px-1 py-2.5 max-md:py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm max-md:text-xs ${
                  drawOfferSent
                    ? 'bg-yellow-500/10 border border-yellow-500/40 text-yellow-400'
                    : 'bg-slate-700/50 border border-slate-600 hover:bg-slate-700 text-slate-300'
                }`}
              >
                <Handshake className="w-4 h-4 shrink-0" /> <span>{t('game.offer_draw')}</span>
              </button>
              <button
                onClick={resign}
                disabled={room.status !== 'playing'}
                className="flex-1 max-w-[110px] max-md:max-w-none flex justify-center items-center gap-1.5 max-md:flex-col max-md:gap-1 px-3 max-md:px-1 py-2.5 max-md:py-3 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold transition-all shadow-lg active:scale-95 text-sm max-md:text-xs"
              >
                <Flag className="w-4 h-4 shrink-0" /> <span>{t('game.resign')}</span>
              </button>
            </div>

            {/* Bonus balance row */}
            <div className="flex justify-center items-center gap-2">
              <button
                onClick={() => setShowBonusModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg text-xs font-semibold text-purple-400 transition-colors"
              >
                <Gem className="w-3 h-3" />
                {t('game.bonuses')}: <span className="font-black ml-0.5">{bonuses}</span>
                <span className="text-purple-500/60 ml-1 max-md:hidden">{t('game.undo_cost', { n: 1 })}</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Chat — hidden on mobile (use drawer instead) */}
        <div className="w-64 md:w-80 lg:w-96 shrink-0 flex flex-col max-md:hidden bg-slate-800/80 rounded-3xl border border-slate-700 overflow-hidden shadow-xl h-full backdrop-blur-md">
          <div className="bg-slate-900/80 p-4 border-b border-slate-700">
            <h3 className="font-bold text-slate-200 flex items-center gap-2">{t('game.chat')}</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chat.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm italic">
                {t('game.no_messages')}
              </div>
            ) : (
              chat.map((msg) => {
                const isMe = msg.sender === nickname;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <span className="text-[10px] text-slate-500 mb-1 px-1">{msg.sender}</span>
                    <div className={`px-4 py-2 rounded-2xl text-sm max-w-[85%] ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-700 text-slate-200 rounded-tl-sm'}`}>
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendChat} className="p-4 bg-slate-900/50 border-t border-slate-700 relative">
            <input
              type="text"
              value={chatMessage}
              onChange={e => setChatMessage(e.target.value)}
              placeholder={t('game.chat_placeholder')}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-4 pr-12 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              disabled={room.status === 'waiting'}
            />
            <button
              type="submit"
              disabled={!chatMessage.trim() || room.status === 'waiting'}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </motion.div>

      {/* ── Mobile: floating chat button ── */}
      <AnimatePresence>
        {!showMobileChat && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={openMobileChat}
            className="md:hidden fixed bottom-5 right-4 z-40 w-13 h-13 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-2xl shadow-xl flex items-center justify-center text-slate-200 active:scale-90 transition-colors"
            style={{ width: 52, height: 52 }}
          >
            <MessageSquare className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 bg-blue-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1 shadow">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Mobile: chat bottom drawer ── */}
      <AnimatePresence>
        {showMobileChat && (
          <>
            {/* backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 z-40 bg-black/50"
              onClick={() => setShowMobileChat(false)}
            />
            {/* drawer */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="md:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col bg-slate-900 border-t border-slate-700 rounded-t-3xl shadow-2xl"
              style={{ height: '65dvh' }}
            >
              {/* drag handle + header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-800 shrink-0">
                <h3 className="font-bold text-slate-200 flex items-center gap-2 text-sm">
                  <MessageSquare className="w-4 h-4 text-blue-400" /> {t('game.chat')}
                </h3>
                <button
                  onClick={() => setShowMobileChat(false)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {chat.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm italic">
                    {t('game.no_messages')}
                  </div>
                ) : (
                  chat.map((msg) => {
                    const isMe = msg.sender === nickname;
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] text-slate-500 mb-1 px-1">{msg.sender}</span>
                        <div className={`px-4 py-2 rounded-2xl text-sm max-w-[85%] ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-700 text-slate-200 rounded-tl-sm'}`}>
                          {msg.text}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* input */}
              <form onSubmit={handleSendChat} className="px-4 py-3 bg-slate-900/80 border-t border-slate-800 shrink-0 relative">
                <input
                  type="text"
                  value={chatMessage}
                  onChange={e => setChatMessage(e.target.value)}
                  placeholder={t('game.chat_placeholder')}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-4 pr-12 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  disabled={room.status === 'waiting'}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!chatMessage.trim() || room.status === 'waiting'}
                  className="absolute right-7 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-400 disabled:opacity-50 transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
