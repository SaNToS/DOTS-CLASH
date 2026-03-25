import { Routes, Route, useLocation, Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Sun, Moon, ShieldCheck } from 'lucide-react';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import Landing from './components/Landing';
import LeaderboardPage from './components/LeaderboardPage';
import GameResultPage from './components/GameResultPage';
import AdminPage from './components/AdminPage';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';

function isLoggedIn() {
  return !!localStorage.getItem('dots_token');
}

function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-400 hover:text-white transition-all"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

function LangToggle() {
  const { lang, toggleLang } = useLanguage();
  return (
    <button
      onClick={toggleLang}
      className="px-2.5 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-400 hover:text-white transition-all text-xs font-bold tracking-wider"
      title="Switch language / Змінити мову"
    >
      {lang === 'en' ? 'UA' : 'EN'}
    </button>
  );
}

function AppInner() {
  const location = useLocation();
  const isGameRoute = location.pathname.startsWith('/room/');
  const { t } = useLanguage();

  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-start overflow-x-hidden relative bg-[#0f172a]">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none z-[-1]">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-purple-500/20 rounded-full blur-[150px]" />
      </div>

      {!isGameRoute && (
        <header className="relative z-50 w-full max-w-6xl flex justify-between items-center py-6 px-6">
          <Link to="/" className="text-2xl md:text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 tracking-tighter drop-shadow-[0_0_15px_rgba(168,85,247,0.5)] hover:opacity-80 transition-opacity">
            DOTS CLASH
          </Link>
          <nav className="flex items-center gap-3 text-sm font-semibold text-slate-400">
            <Link to="/lobby" className="hover:text-white transition-colors hidden sm:block">{t('nav.play')}</Link>
            <Link to="/leaderboard" className="hover:text-white transition-colors hidden sm:block">{t('nav.leaderboard')}</Link>
            {isLoggedIn() && (
              <Link to="/admin" className="p-2 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-400 hover:text-yellow-400 transition-all" title="Admin Panel">
                <ShieldCheck className="w-4 h-4" />
              </Link>
            )}
            <LangToggle />
            <ThemeToggle />
          </nav>
        </header>
      )}

      <main className={`w-full max-w-6xl flex-grow flex flex-col items-center z-10 ${isGameRoute ? 'pt-4 md:pt-10' : 'pt-4'}`}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Landing />} />
            <Route path="/lobby" element={<Lobby />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/room/:roomId" element={<GameRoom />} />
            <Route path="/game/:roomId" element={<GameResultPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </AnimatePresence>
      </main>

      <footer className="mt-8 text-slate-500 text-xs">
        &copy; {new Date().getFullYear()} Dots Multiplayer Game
      </footer>
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </LanguageProvider>
  );
}

export default App;
