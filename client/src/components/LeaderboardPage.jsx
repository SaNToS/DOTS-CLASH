import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, ArrowLeft, Loader2, Crown, Clock, Gamepad2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

const fmt = (secs) => {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export default function LeaderboardPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    const fetchBoard = async () => {
      try {
        const res = await fetch('/api/leaderboard');
        if (res.ok) setData(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchBoard();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-5xl bg-slate-800/80 backdrop-blur-2xl rounded-[2rem] p-6 md:p-10 border border-slate-700/80 shadow-2xl"
    >
      <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors bg-slate-900/50 px-4 py-2 rounded-xl self-start md:self-auto"
        >
          <ArrowLeft className="w-5 h-5" /> {t('lb.back')}
        </button>
        <div className="flex items-center gap-4">
          <Trophy className="w-10 h-10 text-yellow-500 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
          <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-yellow-600">
            {t('lb.title')}
          </h1>
        </div>
      </div>

      <div className="bg-slate-900/50 rounded-2xl overflow-hidden border border-slate-700/50">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 p-4 text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-700/50">
          <div className="col-span-1 text-center">#</div>
          <div className="col-span-3">Player</div>
          <div className="col-span-3 text-center">W / L / D</div>
          <div className="col-span-2 text-center flex items-center justify-center gap-1">
            <Gamepad2 className="w-3 h-3" /> {t('lb.games')}
          </div>
          <div className="col-span-2 text-center flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" /> {t('lb.time')}
          </div>
          <div className="col-span-1 text-right">ELO</div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center p-20">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center p-20 text-slate-500 text-lg">
            {t('lb.no_data')}
          </div>
        ) : (
          <div className="flex flex-col">
            {data.map((player, idx) => (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                key={player.username}
                className={`grid grid-cols-12 gap-2 p-4 items-center border-b border-slate-700/20 last:border-0 hover:bg-slate-800/50 transition-colors ${idx === 0 ? 'bg-gradient-to-r from-yellow-500/10 to-transparent' : ''}`}
              >
                <div className="col-span-1 flex justify-center">
                  {idx === 0 ? <Crown className="w-6 h-6 text-yellow-400" /> :
                   idx === 1 ? <span className="text-slate-300 font-bold">2</span> :
                   idx === 2 ? <span className="text-amber-600 font-bold">3</span> :
                   <span className="text-slate-500 font-medium">{idx + 1}</span>}
                </div>

                <div className="col-span-3 font-bold text-white truncate">
                  {player.username}
                </div>

                <div className="col-span-3 flex justify-center items-center gap-1 text-sm">
                  <span className="text-green-400 font-bold">{player.wins}W</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-red-400 font-bold">{player.losses}L</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">{player.draws}D</span>
                </div>

                <div className="col-span-2 text-center text-slate-300 font-medium text-sm">
                  {player.totalGames || 0}
                </div>

                <div className="col-span-2 text-center text-slate-400 text-sm">
                  {fmt(player.timePlayed)}
                </div>

                <div className="col-span-1 text-right">
                  <span className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-br from-blue-300 to-blue-600">
                    {player.rating}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
