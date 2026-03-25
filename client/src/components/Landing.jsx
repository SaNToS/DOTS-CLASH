import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play, Trophy, Zap, Shield, Users } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

/* ─── Demo game constants ────────────────────────────────────────────── */
const SIZE = 13;
const CELL = 54;
const PAD = 27;
const DIM = SIZE * CELL + PAD * 2;
const DIRS4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];

/* ─── Game logic (self-contained, no imports from server) ────────────── */
function freshBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function detectCaptures(board, playerIdx) {
  const p = playerIdx + 1;
  const opp = p === 1 ? 2 : 1;
  const pTerr = p === 1 ? 3 : 4;

  const esc = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const q = [];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if ((x === 0 || x === SIZE - 1 || y === 0 || y === SIZE - 1) && board[y][x] !== p) {
        esc[y][x] = true;
        q.push([x, y]);
      }
    }
  }

  let head = 0;
  while (head < q.length) {
    const [x, y] = q[head++];
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && !esc[ny][nx] && board[ny][nx] !== p) {
        esc[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
  }

  const nb = board.map(r => [...r]);
  const newCaptures = [];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!esc[y][x] && nb[y][x] !== p) {
        if (nb[y][x] === opp || nb[y][x] === (opp === 1 ? 3 : 4)) newCaptures.push([x, y]);
        nb[y][x] = pTerr;
      }
    }
  }

  return { nb, newCaptures };
}

function pickMove(board, playerIdx) {
  const p = playerIdx + 1;
  const cx = SIZE / 2, cy = SIZE / 2;
  const adj = [], open = [];

  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      if (board[y][x] !== 0) continue;
      let near = false;
      for (const [dx, dy] of DIRS4) {
        if (board[y + dy]?.[x + dx] === p) { near = true; break; }
      }
      near ? adj.push([x, y]) : open.push([x, y]);
    }
  }

  if (adj.length) return adj[Math.floor(Math.random() * Math.min(adj.length, 7))];

  const sorted = open.sort((a, b) =>
    (Math.abs(a[0] - cx) + Math.abs(a[1] - cy)) -
    (Math.abs(b[0] - cx) + Math.abs(b[1] - cy))
  );
  return sorted[Math.floor(Math.random() * Math.min(5, sorted.length))] || null;
}

/* ─── SVG board renderer ─────────────────────────────────────────────── */
function BoardSVG({ board, flashCells }) {
  const px = x => PAD + x * CELL + CELL / 2;
  const py = y => PAD + y * CELL + CELL / 2;
  const isFlash = (x, y) => flashCells.some(([fx, fy]) => fx === x && fy === y);

  return (
    <svg
      viewBox={`0 0 ${DIM} ${DIM}`}
      preserveAspectRatio="xMidYMid slice"
      className="w-full h-full"
      style={{ display: 'block' }}
    >
      <defs>
        <filter id="glowB" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glowR" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="terrGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      {Array.from({ length: SIZE }, (_, i) => (
        <g key={i}>
          <line x1={px(0)} y1={py(i)} x2={px(SIZE - 1)} y2={py(i)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
          <line x1={px(i)} y1={py(0)} x2={px(i)} y2={py(SIZE - 1)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        </g>
      ))}

      {/* Territory fills */}
      {board.flatMap((row, y) => row.map((cell, x) => {
        if (cell !== 3 && cell !== 4) return null;
        const fill = cell === 3 ? 'rgba(96,165,250,0.17)' : 'rgba(248,113,113,0.17)';
        const stroke = cell === 3 ? 'rgba(96,165,250,0.35)' : 'rgba(248,113,113,0.35)';
        return (
          <rect
            key={`t${x}-${y}`}
            x={PAD + x * CELL + 0.5} y={PAD + y * CELL + 0.5}
            width={CELL - 1} height={CELL - 1}
            fill={fill} stroke={stroke} strokeWidth={0.5}
          />
        );
      }))}

      {/* Connection lines */}
      {board.flatMap((row, y) => row.map((cell, x) => {
        if (cell !== 1 && cell !== 2) return null;
        return [[1, 0], [0, 1]].map(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          if (nx >= SIZE || ny >= SIZE || board[ny]?.[nx] !== cell) return null;
          const color = cell === 1 ? '#60a5fa' : '#f87171';
          return (
            <line
              key={`ln${x}-${y}-${dx}-${dy}`}
              x1={px(x)} y1={py(y)} x2={px(nx)} y2={py(ny)}
              stroke={color} strokeWidth={2.5} opacity={0.45}
            />
          );
        });
      }))}

      {/* Empty grid dots */}
      {board.flatMap((row, y) => row.map((cell, x) =>
        cell === 0
          ? <circle key={`g${x}-${y}`} cx={px(x)} cy={py(y)} r={2} fill="rgba(255,255,255,0.06)" />
          : null
      ))}

      {/* Player dots */}
      {board.flatMap((row, y) => row.map((cell, x) => {
        if (cell !== 1 && cell !== 2) return null;
        const isP1 = cell === 1;
        const color = isP1 ? '#60a5fa' : '#f87171';
        const glow = isP1 ? 'rgba(96,165,250,0.45)' : 'rgba(248,113,113,0.45)';
        const flash = isFlash(x, y);
        const r = flash ? 11 : 8;
        const rGlow = flash ? 20 : 16;
        return (
          <g key={`d${x}-${y}`} filter={flash ? `url(#glow${isP1 ? 'B' : 'R'})` : undefined}>
            <circle cx={px(x)} cy={py(y)} r={rGlow} fill={glow} />
            <circle cx={px(x)} cy={py(y)} r={r} fill={color} />
            <circle cx={px(x) - r * 0.28} cy={py(y) - r * 0.28} r={r * 0.35} fill="rgba(255,255,255,0.55)" />
          </g>
        );
      }))}
    </svg>
  );
}

/* ─── Landing page ───────────────────────────────────────────────────── */
export default function Landing() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [board, setBoard] = useState(freshBoard);
  const [turn, setTurn] = useState(0);
  const [score, setScore] = useState([0, 0]);
  const [flashCells, setFlashCells] = useState([]);
  const [fadeOut, setFadeOut] = useState(false);

  const boardRef = useRef(freshBoard());
  const turnRef = useRef(0);
  const scoreRef = useRef([0, 0]);
  const moveCountRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => { document.title = 'Dots Clash — Multiplayer Strategy Game'; }, []);

  const reset = useCallback(() => {
    setFadeOut(true);
    setTimeout(() => {
      boardRef.current = freshBoard();
      turnRef.current = 0;
      scoreRef.current = [0, 0];
      moveCountRef.current = 0;
      setBoard(freshBoard());
      setTurn(0);
      setScore([0, 0]);
      setFlashCells([]);
      setFadeOut(false);
    }, 800);
  }, []);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const b = boardRef.current;
      const t = turnRef.current;
      const empty = b.flat().filter(c => c === 0).length;

      if (empty < 22 || moveCountRef.current > 120) {
        clearInterval(timerRef.current);
        reset();
        return;
      }

      const move = pickMove(b, t);
      if (!move) { clearInterval(timerRef.current); reset(); return; }

      const [mx, my] = move;
      const nb1 = b.map(r => [...r]);
      nb1[my][mx] = t + 1;

      const { nb, newCaptures } = detectCaptures(nb1, t);

      const newScore = [...scoreRef.current];
      newScore[t] += newCaptures.length;
      boardRef.current = nb;
      turnRef.current = t === 0 ? 1 : 0;
      scoreRef.current = newScore;
      moveCountRef.current++;

      setBoard(nb.map(r => [...r]));
      setTurn(turnRef.current);
      setScore([...newScore]);

      if (newCaptures.length > 0) {
        setFlashCells(newCaptures);
        setTimeout(() => setFlashCells([]), 700);
      }
    }, 680);

    return () => clearInterval(timerRef.current);
  }, [reset]);

  const item = {
    hidden: { y: 28, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 80, damping: 18 } },
  };

  return (
    <div className="relative w-full">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap');
      `}</style>
      {/* ── Animated game board background (fixed, full-screen) ── */}
      <div
        className="fixed inset-0 z-0 overflow-hidden transition-opacity duration-700"
        style={{ opacity: fadeOut ? 0 : 1 }}
      >
        <div className="scale-[1.15] opacity-80 min-h-screen min-w-[100vw] flex items-center justify-center">
          <BoardSVG board={board} flashCells={flashCells} />
        </div>
        {/* Stronger blur + Dark overlay for dramatic focus */}
        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[6px]" />
        {/* Deep radial vignette — pushes focus to center */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_75%_at_50%_50%,transparent_15%,rgba(15,23,42,0.95)_100%)]" />
      </div>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <div className="relative z-10 min-h-[100dvh] flex flex-col items-center justify-center px-4">

        {/* Live score — top corners */}
        <div className="absolute top-5 left-5 flex items-center gap-2.5">
          <div className="w-3 h-3 rounded-full bg-blue-400 shadow-[0_0_10px_#60a5fa]" />
          <span className="text-blue-400 font-black text-2xl tabular-nums drop-shadow-[0_0_8px_rgba(96,165,250,0.8)]">
            {score[0]}
          </span>
        </div>
        <div className="absolute top-5 right-5 flex items-center gap-2.5">
          <span className="text-red-400 font-black text-2xl tabular-nums drop-shadow-[0_0_8px_rgba(248,113,113,0.8)]">
            {score[1]}
          </span>
          <div className="w-3 h-3 rounded-full bg-red-400 shadow-[0_0_10px_#f87171]" />
        </div>

        {/* Turn indicator */}
        <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/60 border border-white/10 backdrop-blur-sm">
          <div
            className={`w-2 h-2 rounded-full animate-pulse transition-colors duration-300 ${turn === 0 ? 'bg-blue-400 shadow-[0_0_6px_#60a5fa]' : 'bg-red-400 shadow-[0_0_6px_#f87171]'
              }`}
          />
          <span className="text-slate-300 text-xs font-semibold">
            {turn === 0 ? 'Blue' : 'Red'}&apos;s turn
          </span>
        </div>

        {/* Main hero card */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.15, delayChildren: 0.1 } } }}
          className="text-center max-w-4xl w-full mt-10"
        >
          <motion.div variants={item} className="mb-6 inline-flex items-center gap-3 px-6 py-2.5 rounded-full border border-blue-400/50 bg-blue-500/15 text-blue-300 text-sm font-bold tracking-wide backdrop-blur-md shadow-[0_0_20px_rgba(59,130,246,0.3)]">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse shadow-[0_0_8px_#60a5fa]" />
            {t('landing.tag')}
          </motion.div>

          <motion.div
            variants={item}
            className="bg-slate-900/40 border border-white/10 rounded-[2.5rem] backdrop-blur-[24px] p-8 md:p-14 shadow-[0_0_120px_-20px_rgba(139,92,246,0.4)] mb-10 overflow-hidden relative"
          >
            {/* Inner glow effect */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50 blur-sm" />

            <h1 
              className="text-6xl md:text-[5.5rem] mb-6 tracking-tighter leading-[1.0] text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 drop-shadow-xl whitespace-pre-line text-center"
              style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 900, textTransform: 'uppercase' }}
            >
              ПЕРЕХИТРИ<br/>СВОГО СУПЕРНИКА
            </h1>
            <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed mb-12 font-medium">
              {t('landing.subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row gap-5 justify-center">
              <button
                onClick={() => navigate('/lobby')}
                className="group relative flex items-center justify-center gap-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-10 py-5 rounded-2xl font-black text-xl hover:scale-[1.03] active:scale-95 transition-all shadow-[0_0_40px_-5px_rgba(99,102,241,0.6)]"
              >
                <div className="absolute inset-0 rounded-2xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Play className="w-6 h-6 fill-current group-hover:translate-x-1 transition-transform" />
                {t('landing.play')}
              </button>
              <button
                onClick={() => navigate('/leaderboard')}
                className="group flex items-center justify-center gap-3 bg-slate-800/80 hover:bg-slate-700/90 border border-slate-500/40 text-white px-10 py-5 rounded-2xl font-bold text-xl hover:scale-[1.03] active:scale-95 transition-all backdrop-blur-md shadow-lg"
              >
                <Trophy className="w-6 h-6 text-yellow-400 group-hover:scale-110 transition-transform" />
                {t('landing.rankings')}
              </button>
            </div>
          </motion.div>

          {/* Mini stat pills */}
          <motion.div variants={item} className="flex justify-center gap-3 flex-wrap">
            {[
              { label: 'Real-time PvP', color: 'blue' },
              { label: 'ELO Ranking', color: 'yellow' },
              { label: 'Play vs AI', color: 'purple' },
              { label: 'No Download', color: 'emerald' },
            ].map(({ label, color }) => (
              <span
                key={label}
                className={`px-3 py-1 rounded-full text-xs font-semibold bg-slate-900/60 border backdrop-blur-sm
                  ${color === 'blue' ? 'border-blue-500/30 text-blue-400' : ''}
                  ${color === 'yellow' ? 'border-yellow-500/30 text-yellow-400' : ''}
                  ${color === 'purple' ? 'border-purple-500/30 text-purple-400' : ''}
                  ${color === 'emerald' ? 'border-emerald-500/30 text-emerald-400' : ''}
                `}
              >
                {label}
              </span>
            ))}
          </motion.div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 opacity-40"
        >
          <div className="w-px h-10 bg-gradient-to-b from-transparent to-slate-400" />
          <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        </motion.div>
      </div>

      {/* ── FEATURES — solid bg so board doesn't show through ────── */}
      <div className="relative z-10">
        {/* Gradient transition */}
        <div className="h-28 bg-gradient-to-b from-transparent to-[#0f172a]" />

        <div className="bg-[#0f172a] pb-28 px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, staggerChildren: 0.15 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto"
          >
            <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-8 rounded-3xl border border-slate-700/50 backdrop-blur-xl relative overflow-hidden group hover:border-blue-500/50 transition-colors">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <Zap className="w-10 h-10 text-blue-400 mb-5" />
              <h3 className="text-xl font-bold text-white mb-3">{t('landing.feat1.title')}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{t('landing.feat1.desc')}</p>
            </div>

            <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-8 rounded-3xl border border-slate-700/50 backdrop-blur-xl relative overflow-hidden group hover:border-purple-500/50 transition-colors">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <Shield className="w-10 h-10 text-purple-400 mb-5" />
              <h3 className="text-xl font-bold text-white mb-3">{t('landing.feat2.title')}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{t('landing.feat2.desc')}</p>
            </div>

            <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-8 rounded-3xl border border-slate-700/50 backdrop-blur-xl relative overflow-hidden group hover:border-emerald-500/50 transition-colors">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <Users className="w-10 h-10 text-emerald-400 mb-5" />
              <h3 className="text-xl font-bold text-white mb-3">{t('landing.feat3.title')}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{t('landing.feat3.desc')}</p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
