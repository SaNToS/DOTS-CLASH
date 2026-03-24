import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play, Trophy, Users, Shield, Zap } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function Landing() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.2, delayChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { y: 30, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } }
  };

  return (
    <div className="w-full flex flex-col items-center">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="text-center max-w-4xl mx-auto pt-10 pb-20 px-6"
      >
        <motion.div variants={itemVariants} className="mb-6 inline-flex border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 rounded-full text-blue-400 font-medium text-sm">
          <span className="animate-pulse mr-2 w-2 h-2 rounded-full bg-blue-400 inline-block"></span>
          {t('landing.tag')}
        </motion.div>

        <motion.h1 variants={itemVariants} className="text-5xl md:text-8xl font-black mb-6 tracking-tight leading-none text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-200 to-slate-500 drop-shadow-xl whitespace-pre-line">
          {t('landing.headline')}
        </motion.h1>

        <motion.p variants={itemVariants} className="text-lg md:text-2xl text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
          {t('landing.subtitle')}
        </motion.p>

        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button
            onClick={() => navigate('/lobby')}
            className="group relative flex items-center gap-3 bg-white text-slate-900 px-8 py-4 rounded-2xl font-black text-lg hover:scale-105 transition-all shadow-[0_0_40px_-10px_rgba(255,255,255,0.4)]"
          >
            <Play className="w-6 h-6 fill-current group-hover:translate-x-1 transition-transform" />
            {t('landing.play')}
          </button>

          <button
            onClick={() => navigate('/leaderboard')}
            className="flex items-center gap-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:scale-105 transition-all backdrop-blur-md"
          >
            <Trophy className="w-6 h-6 text-yellow-400" />
            {t('landing.rankings')}
          </button>
        </motion.div>
      </motion.div>

      {/* Features Grid */}
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl px-6 pb-20"
      >
        <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-8 rounded-3xl border border-slate-700/50 backdrop-blur-xl relative overflow-hidden group hover:border-blue-500/50 transition-colors">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <Zap className="w-12 h-12 text-blue-400 mb-6" />
          <h3 className="text-2xl font-bold text-white mb-3">{t('landing.feat1.title')}</h3>
          <p className="text-slate-400">{t('landing.feat1.desc')}</p>
        </div>

        <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-8 rounded-3xl border border-slate-700/50 backdrop-blur-xl relative overflow-hidden group hover:border-purple-500/50 transition-colors">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
           <Shield className="w-12 h-12 text-purple-400 mb-6" />
           <h3 className="text-2xl font-bold text-white mb-3">{t('landing.feat2.title')}</h3>
           <p className="text-slate-400">{t('landing.feat2.desc')}</p>
        </div>

        <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-8 rounded-3xl border border-slate-700/50 backdrop-blur-xl relative overflow-hidden group hover:border-green-500/50 transition-colors">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
           <Users className="w-12 h-12 text-green-400 mb-6" />
           <h3 className="text-2xl font-bold text-white mb-3">{t('landing.feat3.title')}</h3>
           <p className="text-slate-400">{t('landing.feat3.desc')}</p>
        </div>
      </motion.div>
    </div>
  );
}
