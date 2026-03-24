import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import clsx from 'clsx';
import { User, KeyRound, Play, Trophy, LogIn, UserPlus, LogOut, Gem, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';

export default function Lobby() {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [roomCode, setRoomCode] = useState('');

  const [mode, setMode] = useState('create'); // 'create' or 'join'
  const [authMode, setAuthMode] = useState('guest'); // 'guest', 'login', 'register'
  const [user, setUser] = useState(null);

  const [settings, setSettings] = useState({ boardSize: 20, pieceStyle: 'dots', color: 'blue' });
  const [error, setError] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [activeGameRoom, setActiveGameRoom] = useState(null);
  const [bonuses, setBonuses] = useState(null);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);
  const [buyError, setBuyError] = useState('');
  const [buySuccess, setBuySuccess] = useState(0); // added amount on success

  const { socket, isConnected } = useSocket();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();

  const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'cancel' | null

  useEffect(() => {
    const token = localStorage.getItem('dots_token');
    const storedUser = localStorage.getItem('dots_username');
    if (token && storedUser) {
      setUser({ token, username: storedUser });
      setAuthMode('logged_in');
      setNickname(storedUser);
      fetch('/api/auth/bonuses', {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.ok ? r.json() : null).then(d => { if (d) setBonuses(d.bonuses); }).catch(() => {});
    }

    // Handle return from Stripe Checkout
    const payment = searchParams.get('payment');
    if (payment === 'success') {
      setPaymentStatus('success');
      setSearchParams({});
      // Re-fetch bonus balance after successful payment
      if (token) {
        fetch('/api/auth/bonuses', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setBonuses(d.bonuses); })
          .catch(() => {});
      }
      setTimeout(() => setPaymentStatus(null), 5000);
    } else if (payment === 'cancel') {
      setPaymentStatus('cancel');
      setSearchParams({});
      setTimeout(() => setPaymentStatus(null), 4000);
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('room_created', (room) => {
      navigate(`/room/${room.id}`, { state: { nickname: user ? user.username : nickname } });
    });

    socket.on('room_joined', (room) => {
      navigate(`/room/${room.id}`, { state: { nickname: user ? user.username : nickname } });
    });

    socket.on('match_found', (room) => {
      setIsMatchmaking(false);
      navigate(`/room/${room.id}`, { state: { nickname: user ? user.username : nickname } });
    });

    socket.on('matchmaking_queued', () => {
      setIsMatchmaking(true);
    });

    socket.on('matchmaking_cancelled', () => {
      setIsMatchmaking(false);
    });

    socket.on('error', (err) => {
      setError(err.message);
      setIsMatchmaking(false);
    });

    socket.on('active_game_found', (roomId) => {
      setActiveGameRoom(roomId);
    });

    return () => {
      socket.off('room_created');
      socket.off('room_joined');
      socket.off('match_found');
      socket.off('matchmaking_queued');
      socket.off('matchmaking_cancelled');
      socket.off('error');
    };
  }, [socket, navigate, nickname, user]);

  useEffect(() => {
    if (!isConnected) return;
    const currentName = user ? user.username : nickname;
    const currentToken = user ? user.token : null;
    if (currentName) {
      socket.emit('check_active_game', { nickname: currentName, token: currentToken });
    }
  }, [isConnected, user, nickname, socket]);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) {
        const data = await res.json();
        setLeaderboardData(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openLeaderboard = () => {
    setShowLeaderboard(true);
    fetchLeaderboard();
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: nickname, password })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      localStorage.setItem('dots_token', data.token);
      localStorage.setItem('dots_username', data.username);
      setUser({ token: data.token, username: data.username });
      setAuthMode('logged_in');
      setPassword('');
      setError('');
    } catch (err) {
      setError('Network error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('dots_token');
    localStorage.removeItem('dots_username');
    setUser(null);
    setAuthMode('guest');
    setNickname('');
    setBonuses(null);
  };

  const handleBuyBonus = async (pack) => {
    if (!user) return;
    setBuyLoading(pack);
    setBuyError('');
    try {
      const res = await fetch('/api/payment/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ pack })
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url; // redirect to Stripe Checkout
      } else {
        setBuyError(data.error || 'Could not start payment');
        setBuyLoading(false);
      }
    } catch {
      setBuyError('Network error — try again');
      setBuyLoading(false);
    }
  };

  const handlePlaySubmit = (e) => {
    e.preventDefault();
    if (!user && !nickname.trim()) {
      setError('Nickname is required for guests');
      return;
    }

    const playName = user ? user.username : nickname;
    const token = user ? user.token : null;

    if (mode === 'create') {
      socket.emit('create_room', { nickname: playName, settings, token });
    } else {
      if (!roomCode.trim()) {
        setError('Room code is required');
        return;
      }
      socket.emit('join_room', { nickname: playName, roomId: roomCode.toUpperCase(), token });
    }
  };

  const handleBotSubmit = () => {
    if (!user && !nickname.trim()) {
      setError('Nickname is required for guests');
      return;
    }
    const playName = user ? user.username : nickname;
    const token = user ? user.token : null;
    socket.emit('create_bot_room', { nickname: playName, settings, token });
  };

  const handleFindMatch = () => {
    if (!user && !nickname.trim()) {
      setError('Nickname is required for guests');
      return;
    }
    const playName = user ? user.username : nickname;
    const token = user ? user.token : null;
    socket.emit('find_match', { nickname: playName, settings, token });
  };

  const handleCancelMatch = () => {
    socket.emit('cancel_match');
  };

  return (
    <div className="flex flex-col items-center w-full max-w-md relative">
      <AnimatePresence>
        {activeGameRoom && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="w-full mb-4 p-4 bg-gradient-to-r from-yellow-600/90 to-orange-600/90 rounded-2xl border border-yellow-400/50 shadow-[0_0_30px_rgba(234,179,8,0.4)] backdrop-blur-xl flex justify-between items-center z-50 overflow-hidden"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_70%)] pointer-events-none" />
            <div className="flex items-center gap-3 relative z-10">
              <span className="w-3 h-3 rounded-full bg-yellow-300 animate-pulse shadow-[0_0_10px_rgba(253,224,71,1)]"></span>
              <span className="text-white font-black text-sm tracking-widest drop-shadow-md">{t('lobby.resume')}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/room/${activeGameRoom}`)}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl font-bold transition-all hover:scale-105 active:scale-95 shadow-inner relative z-10"
            >
              {t('lobby.rejoin')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -30 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-gradient-to-b from-slate-800/90 to-slate-900/90 rounded-[2rem] p-8 border border-white/10 shadow-[0_0_50px_-12px_rgba(59,130,246,0.4)] relative overflow-hidden backdrop-blur-2xl ring-1 ring-white/5"
      >
      <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.15),transparent_50%)] pointer-events-none animate-pulse-slow z-0" />

      {paymentStatus === 'success' && (
        <div className="relative z-10 mb-4 px-4 py-3 bg-emerald-600/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm font-semibold text-center">
          Payment successful! Bonuses added to your account.
        </div>
      )}
      {paymentStatus === 'cancel' && (
        <div className="relative z-10 mb-4 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-slate-400 text-sm text-center">
          Payment cancelled.
        </div>
      )}

      <div className="relative z-10">
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-white/10">
          <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 tracking-tight drop-shadow-sm">
            {t('lobby.title')}
          </h2>
        <div className="flex gap-2 items-center">
          <button onClick={openLeaderboard} title={t('lobby.leaderboard')} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-yellow-400 transition-colors shadow-[0_0_15px_-3px_rgba(234,179,8,0.3)]">
            <Trophy className="w-4 h-4" />
          </button>
          <span className={clsx("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider shadow-lg",
            isConnected ? "bg-green-500/10 text-green-400 border border-green-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"
          )}>
            <span className={clsx("w-2 h-2 rounded-full", isConnected ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" : "bg-red-400 animate-pulse")} />
            {isConnected ? t('lobby.online') : t('lobby.offline')}
          </span>
        </div>
      </div>
      </div>

      {showLeaderboard && (
        <div className="absolute inset-0 z-50 bg-slate-900/95 p-6 overflow-y-auto flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Trophy className="text-yellow-400" /> {t('lobby.leaderboard')}</h2>
            <button onClick={() => setShowLeaderboard(false)} className="text-slate-400 hover:text-white px-3 py-1 bg-slate-800 rounded-lg">{t('lobby.close')}</button>
          </div>
          <div className="space-y-2 flex-1">
            {leaderboardData.length === 0 ? (
              <div className="text-slate-500 text-center mt-10">{t('lobby.no_players')}</div>
            ) : (
              leaderboardData.map((p, i) => (
                <div key={p.username} className="flex justify-between items-center bg-slate-800 p-3 rounded-xl border border-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-500 w-4">{i + 1}</span>
                    <span className="font-semibold text-slate-200">{p.username}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-yellow-400 font-bold mr-3">{p.rating} ELO</span>
                    <span className="text-green-400">{p.wins}W</span>
                    <span className="text-slate-500 mx-1">-</span>
                    <span className="text-red-400">{p.losses}L</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {authMode === 'logged_in' ? (
        <div className="mb-6 space-y-2">
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl flex justify-between items-center">
            <div>
              <div className="text-sm text-slate-400">{t('lobby.logged_in_as')}</div>
              <div className="text-lg font-bold text-blue-400">{user.username}</div>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 transition-colors bg-slate-800 rounded-lg">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
          {bonuses !== null && (
            <button
              onClick={() => setShowBonusModal(true)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-300 hover:bg-purple-500/20 transition-colors"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Gem className="w-4 h-4" />
                {t('lobby.bonuses')}: <span className="text-purple-200 font-bold">{bonuses}</span>
              </div>
              <span className="text-xs text-purple-400 font-semibold">{t('lobby.buy_bonuses')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="mb-6">
          <div className="flex gap-2 p-1 bg-slate-900/50 rounded-xl mb-4 border border-slate-700/50">
            <button onClick={() => { setAuthMode('guest'); setError(''); }} className={clsx("flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors", authMode === 'guest' ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-slate-300")}>{t('lobby.guest')}</button>
            <button onClick={() => { setAuthMode('login'); setError(''); }} className={clsx("flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors", authMode === 'login' ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-slate-300")}>{t('lobby.login')}</button>
            <button onClick={() => { setAuthMode('register'); setError(''); }} className={clsx("flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors", authMode === 'register' ? "bg-green-600 text-white shadow" : "text-slate-400 hover:text-slate-300")}>{t('lobby.register')}</button>
          </div>

          {(authMode === 'login' || authMode === 'register') ? (
            <form onSubmit={handleAuth} className="space-y-4 bg-slate-800/50 p-4 rounded-xl border border-slate-700">
              <div>
                <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder={t('lobby.username')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('lobby.password')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              {error && <div className="text-xs text-red-400">{error}</div>}
              <button type="submit" className={clsx("w-full py-2 rounded-lg font-bold text-sm text-white transition-all active:scale-95", authMode === 'login' ? "bg-blue-600 hover:bg-blue-500" : "bg-green-600 hover:bg-green-500")}>
                {authMode === 'login' ? t('lobby.log_in') : t('lobby.create_account')}
              </button>
            </form>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">{t('lobby.guest_nickname')}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. MasterGamer"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                  maxLength={15}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {(authMode === 'guest' || authMode === 'logged_in') && (
        <div className="relative z-10">
          <div className="flex gap-6 mb-8 border-b border-white/5 pb-px relative">
            <button onClick={() => { setMode('create'); setError(''); }} className={clsx("pb-4 font-bold transition-all duration-300 px-2 text-sm relative", mode === 'create' ? "text-blue-400" : "text-slate-500 hover:text-slate-300")}>
              {t('lobby.create_ops')}
              {mode === 'create' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.8)]" />}
            </button>
            <button onClick={() => { setMode('join'); setError(''); }} className={clsx("pb-4 font-bold transition-all duration-300 px-2 text-sm relative", mode === 'join' ? "text-blue-400" : "text-slate-500 hover:text-slate-300")}>
              {t('lobby.join_ops')}
              {mode === 'join' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.8)]" />}
            </button>
          </div>

          {isMatchmaking ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-6">
               <div className="w-16 h-16 border-4 border-yellow-500 border-b-transparent rounded-full animate-spin" />
               <h3 className="text-xl font-bold text-white tracking-widest animate-pulse">{t('lobby.searching')}</h3>
               <button onClick={handleCancelMatch} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 font-bold transition-colors">
                  {t('lobby.cancel')}
               </button>
            </div>
          ) : (
            <form onSubmit={handlePlaySubmit} className="space-y-6">
            {error && authMode === 'guest' && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}

            {mode === 'join' && (
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">{t('lobby.room_code')}</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                  <input type="text" value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="e.g. A1B2C3" className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all uppercase tracking-widest" maxLength={6} />
                </div>
              </div>
            )}

            {mode === 'create' && (
              <div className="space-y-4 p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-400">{t('lobby.board_size')}</span>
                  <select value={settings.boardSize} onChange={e => setSettings({...settings, boardSize: parseInt(e.target.value)})} className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-blue-500">
                    <option value={10}>10x10</option>
                    <option value={15}>15x15</option>
                    <option value={20}>20x20</option>
                    <option value={30}>30x30</option>
                  </select>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-400">{t('lobby.my_color')}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSettings({...settings, color: 'blue'})} className={clsx("w-5 h-5 rounded-full bg-blue-500 ring-offset-2 ring-offset-slate-900 transition-all", settings.color === 'blue' ? "ring-2 ring-blue-400" : "")} />
                    <button type="button" onClick={() => setSettings({...settings, color: 'red'})} className={clsx("w-5 h-5 rounded-full bg-red-500 ring-offset-2 ring-offset-slate-900 transition-all", settings.color === 'red' ? "ring-2 ring-red-400" : "")} />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-400">{t('lobby.piece_style')}</span>
                  <select value={settings.pieceStyle} onChange={e => setSettings({...settings, pieceStyle: e.target.value})} className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="dots">{t('lobby.dots')}</option>
                    <option value="crosses">{t('lobby.crosses')}</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button type="submit" disabled={!isConnected} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-blue-500/25 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                <Play className="w-4 h-4 fill-current" />
                {mode === 'create' ? t('lobby.create_game') : t('lobby.join_game')}
              </button>

              {mode === 'create' && (
                <div className="flex gap-3">
                  <button type="button" onClick={handleBotSubmit} disabled={!isConnected} className="flex-1 flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-blue-500/50 text-white py-3 px-2 rounded-2xl font-bold transition-all duration-300 active:scale-95 disabled:opacity-50">
                    <User className="w-5 h-5 text-blue-400" />
                    <span className="text-[11px] uppercase tracking-wider">{t('lobby.vs_ai')}</span>
                  </button>
                  <button type="button" onClick={handleFindMatch} disabled={!isConnected} className="flex-1 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/40 hover:border-yellow-400 hover:shadow-[0_0_20px_rgba(234,179,8,0.3)] text-yellow-500 py-3 px-2 rounded-2xl font-bold transition-all duration-300 active:scale-95 disabled:opacity-50">
                    <Trophy className="w-5 h-5 text-yellow-400 drop-shadow-[0_0_5px_rgba(234,179,8,0.8)]" />
                    <span className="text-[11px] uppercase tracking-wider">{t('lobby.ranked')}</span>
                  </button>
                </div>
              )}
            </div>
          </form>
          )}
          {/* Mini Instructions */}
          <div className="mt-8 p-5 bg-gradient-to-r from-blue-900/10 to-indigo-900/10 rounded-2xl border border-blue-500/20 backdrop-blur-sm shadow-inner relative z-10">
            <h4 className="text-blue-400 font-bold text-xs mb-3 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,0.8)]"></span>
              {t('lobby.instructions')}
            </h4>
            <ul className="text-xs text-slate-300 space-y-2 pl-4 list-disc marker:text-indigo-400 leading-relaxed font-medium">
              <li>{t('lobby.rule1')}</li>
              <li>{t('lobby.rule2')}</li>
              <li>{t('lobby.rule3')}</li>
            </ul>
          </div>
        </div>
      )}
      {showBonusModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/95 p-6 flex flex-col rounded-[2rem]">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Gem className="text-purple-400" /> {t('bonus.title')}</h2>
            <button onClick={() => { setShowBonusModal(false); setBuyError(''); setBuySuccess(0); }} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm text-slate-400 mb-2">{t('bonus.subtitle')}</p>
          <p className="text-sm text-purple-300 font-semibold mb-6">{t('bonus.earn', { n: 3 })}</p>
          <p className="text-sm text-slate-300 mb-4">{t('bonus.balance', { n: bonuses ?? 0 })}</p>
          {buyError && (
            <div className="mb-3 px-4 py-2.5 bg-red-900/40 border border-red-700/40 rounded-xl text-red-300 text-sm">{buyError}</div>
          )}
          {buySuccess > 0 && (
            <div className="mb-3 px-4 py-2.5 bg-emerald-900/40 border border-emerald-700/40 rounded-xl text-emerald-300 text-sm font-semibold">+{buySuccess} bonuses added!</div>
          )}
          <div className="space-y-3">
            {[{ pack: 'small', label: t('bonus.small'), amount: 5 }, { pack: 'medium', label: t('bonus.medium'), amount: 20 }, { pack: 'large', label: t('bonus.large'), amount: 50 }].map(({ pack, label }) => (
              <button
                key={pack}
                disabled={!!buyLoading || buySuccess > 0}
                onClick={() => handleBuyBonus(pack)}
                className="w-full flex justify-between items-center px-5 py-3.5 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 rounded-xl text-white font-semibold transition-colors disabled:opacity-50"
              >
                <span>{label}</span>
                <span className="text-purple-300 text-sm">{buyLoading === pack ? '...' : t('bonus.buy')}</span>
              </button>
            ))}
          </div>
          <button onClick={() => { setShowBonusModal(false); setBuyError(''); setBuySuccess(0); }} className="mt-6 text-sm text-slate-500 hover:text-slate-300 transition-colors">{t('bonus.close')}</button>
        </div>
      )}
    </motion.div>
    </div>
  );
}
