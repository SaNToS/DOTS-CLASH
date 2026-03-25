import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, Clock, ArrowLeft, Share2, Copy, Check, Play } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const HOST = import.meta.env.VITE_SERVER_URL || '';

const fmt = (secs) => {
  if (!secs) return '0s';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

/* ─── Static board canvas ──────────────────────────────────────── */
function StaticBoard({ board }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!board || !board.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const boardSize = board.length;
    const dpr = window.devicePixelRatio || 1;
    const cssSize = canvas.clientWidth || 400;

    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    ctx.scale(dpr, dpr);

    const pad = Math.max(12, cssSize * 0.04);
    const gridArea = cssSize - pad * 2;
    const cell = gridArea / (boardSize - 1);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cssSize, cssSize);

    // Territory fills (drawn first, behind grid)
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const v = board[row][col];
        if (v !== 3 && v !== 4) continue;
        const cx = pad + col * cell;
        const cy = pad + row * cell;
        ctx.fillStyle = v === 3
          ? 'rgba(59, 130, 246, 0.28)'
          : 'rgba(239, 68, 68, 0.28)';
        ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
      }
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < boardSize; i++) {
      const x = pad + i * cell;
      const y = pad + i * cell;
      ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, cssSize - pad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(cssSize - pad, y); ctx.stroke();
    }

    // Dots
    const dotR = Math.max(2, cell * 0.28);
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const v = board[row][col];
        if (v !== 1 && v !== 2) continue;
        const cx = pad + col * cell;
        const cy = pad + row * cell;

        // Glow
        const color = v === 1 ? '59, 130, 246' : '239, 68, 68';
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR * 2.5);
        grad.addColorStop(0, `rgba(${color}, 0.4)`);
        grad.addColorStop(1, `rgba(${color}, 0)`);
        ctx.beginPath();
        ctx.arc(cx, cy, dotR * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Solid dot
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        ctx.fillStyle = v === 1 ? '#3b82f6' : '#ef4444';
        ctx.fill();
      }
    }

    // Dot count label
    let p1 = 0, p2 = 0;
    board.forEach(row => row.forEach(v => { if (v === 1) p1++; if (v === 2) p2++; }));
    ctx.font = `bold ${Math.max(10, cssSize * 0.03)}px monospace`;
    ctx.fillStyle = '#3b82f6';
    ctx.fillText(`P1: ${p1} dots`, pad, cssSize - 4);
    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'right';
    ctx.fillText(`P2: ${p2} dots`, cssSize - pad, cssSize - 4);
    ctx.textAlign = 'left';
  }, [board]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-2xl border border-slate-700/50 shadow-xl"
      style={{ aspectRatio: '1 / 1', maxWidth: '480px', display: 'block', margin: '0 auto' }}
    />
  );
}

/* ─── Page ─────────────────────────────────────────────────────── */
export default function GameResultPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => { document.title = 'Game Result — Dots Clash'; return () => { document.title = 'Dots Clash — Multiplayer Strategy Game'; }; }, []);

  useEffect(() => {
    fetch(`${HOST}/api/game/${roomId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setRecord(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [roomId]);

  const shareUrl = window.location.href;
  const shareText = record
    ? `Dots Clash: ${record.player1} vs ${record.player2} — ${record.score1}:${record.score2}. Check it out:`
    : 'Check out this Dots Clash game!';

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-xl mx-auto px-4 pt-8 pb-16"
    >
      <button onClick={() => navigate('/')} className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> {t('result.back')}
      </button>

      <div className="bg-slate-800/80 backdrop-blur-xl rounded-3xl border border-slate-700 p-6 md:p-8 shadow-2xl space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-yellow-400 shrink-0" />
          <h1 className="text-2xl font-black text-white">{t('result.title')}</h1>
          <span className="ml-auto text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded-lg shrink-0">{roomId}</span>
        </div>

        {loading && <div className="text-center py-12 text-slate-400">{t('result.loading')}</div>}

        {!loading && !record && (
          <div className="text-center py-12 text-slate-500">
            {t('result.not_found')}
          </div>
        )}

        {record && (
          <>
            {/* Score bar */}
            <div className="flex items-center justify-between bg-slate-900/60 rounded-2xl p-5">
              <div className="text-center flex-1">
                <div className="w-3 h-3 rounded-full bg-blue-500 mx-auto mb-1" />
                <div className="font-bold text-white">{record.player1}</div>
                {record.winnerIndex === 0 && (
                  <div className="text-xs text-yellow-400 font-bold mt-1">{t('result.winner')}</div>
                )}
              </div>
              <div className="text-center px-4">
                <div className="text-5xl font-black text-white tabular-nums">
                  {record.score1}<span className="text-slate-600 mx-1">:</span>{record.score2}
                </div>
                <div className="text-xs text-slate-500 mt-1 capitalize">
                  {record.reason?.replace(/_/g, ' ')}
                </div>
              </div>
              <div className="text-center flex-1">
                <div className="w-3 h-3 rounded-full bg-red-500 mx-auto mb-1" />
                <div className="font-bold text-white">{record.player2}</div>
                {record.winnerIndex === 1 && (
                  <div className="text-xs text-yellow-400 font-bold mt-1">{t('result.winner')}</div>
                )}
              </div>
            </div>

            {record.winnerIndex === null && (
              <div className="text-center text-blue-400 font-bold">{t('result.draw')}</div>
            )}

            {/* Board snapshot */}
            {record.boardState ? (
              <div>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">
                  {t('result.board')}
                </p>
                <StaticBoard board={record.boardState} />
              </div>
            ) : (
              <div className="text-center text-slate-600 text-sm py-4 border border-dashed border-slate-700 rounded-xl">
                {t('result.no_board')}
              </div>
            )}

            {/* Duration */}
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Clock className="w-4 h-4" />
              <span>{t('result.duration')}: <span className="text-white font-medium">{fmt(record.duration)}</span></span>
              <span className="mx-2 text-slate-600">·</span>
              <span>{t('result.played')}: <span className="text-white font-medium">
                {new Date(record.endedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </span></span>
            </div>

            {/* Play Again */}
            <button
              onClick={() => navigate('/lobby')}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-bold transition-colors"
            >
              <Play className="w-4 h-4 fill-current" />
              {t('result.play_again')}
            </button>

            {/* Share */}
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
                <Share2 className="w-3 h-3" /> {t('result.share')}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? t('result.copied') : t('result.copy')}
                </button>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
                >X / Twitter</a>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                >Telegram</a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-green-800 hover:bg-green-700 text-white text-sm font-medium transition-colors"
                >WhatsApp</a>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
