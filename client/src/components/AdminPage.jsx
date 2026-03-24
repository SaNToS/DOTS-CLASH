import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Edit2, Trash2, Gem, X, Check, ChevronLeft, Download, Upload } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const API = '/api/admin';

function getToken() {
  return localStorage.getItem('dots_token');
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [editUser, setEditUser] = useState(null); // user being edited
  const [editData, setEditData] = useState({});
  const [bonusUser, setBonusUser] = useState(null);
  const [bonusAmount, setBonusAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [restoreData, setRestoreData] = useState(null); // parsed backup JSON
  const [restorePasswords, setRestorePasswords] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef(null);
  const { t } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API}/check`, { headers: authHeaders() })
      .then(r => {
        if (r.status === 401 || r.status === 403) { setAccessDenied(true); setLoading(false); return null; }
        return r.json();
      })
      .then(d => { if (d) loadUsers(); })
      .catch(() => { setAccessDenied(true); setLoading(false); });
  }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(q ? users.filter(u => u.username.toLowerCase().includes(q)) : users);
  }, [search, users]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/users`, { headers: authHeaders() });
      const data = await res.json();
      setUsers(data);
      setFiltered(data);
    } catch {}
    setLoading(false);
  };

  const handleDelete = async (user) => {
    if (!window.confirm(t('admin.confirm_delete', { name: user.username }))) return;
    await fetch(`${API}/users/${user.id}`, { method: 'DELETE', headers: authHeaders() });
    setUsers(prev => prev.filter(u => u.id !== user.id));
  };

  const openEdit = (user) => {
    setEditUser(user);
    setEditData({
      wins: user.wins, losses: user.losses, draws: user.draws,
      rating: user.rating, bonuses: user.bonuses,
      totalGames: user.totalGames, timePlayed: user.timePlayed,
      newPassword: ''
    });
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    const body = { ...editData };
    if (!body.newPassword) delete body.newPassword;
    ['wins','losses','draws','rating','bonuses','totalGames','timePlayed'].forEach(k => {
      if (body[k] !== undefined) body[k] = Number(body[k]);
    });
    const res = await fetch(`${API}/users/${editUser.id}`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(body)
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u));
      setEditUser(null);
    }
    setSaving(false);
  };

  const handleAwardBonuses = async () => {
    if (!bonusUser) return;
    setSaving(true);
    const res = await fetch(`${API}/users/${bonusUser.id}/bonuses`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ amount: Number(bonusAmount) })
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, bonuses: updated.bonuses } : u));
      setBonusUser(null);
      setBonusAmount(0);
    }
    setSaving(false);
  };

  const handleDownloadBackup = async () => {
    const res = await fetch(`${API}/backup`, { headers: authHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dots_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!Array.isArray(parsed.users)) throw new Error('invalid');
        setRestoreData(parsed);
        setRestoreResult(null);
        setRestorePasswords(false);
      } catch {
        setRestoreData({ error: true });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!restoreData || restoreData.error) return;
    setRestoring(true);
    try {
      const res = await fetch(`${API}/restore`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ users: restoreData.users, restorePasswords })
      });
      const result = await res.json();
      setRestoreResult(result);
      if (result.ok) { loadUsers(); setRestoreData(null); }
    } catch {
      setRestoreResult({ ok: false });
    }
    setRestoring(false);
  };

  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-2xl font-bold text-red-400">{t('admin.no_access')}</p>
        <button onClick={() => navigate('/')} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold">
          {t('admin.back')}
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-slate-400">{t('admin.loading')}</div>;
  }

  return (
    <div className="w-full px-4 pb-12">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/')} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-xl transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-black text-white">{t('admin.title')}</h1>
      </div>

      {/* Backup / Restore toolbar */}
      <div className="flex gap-3 mb-5">
        <button
          onClick={handleDownloadBackup}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-300 border border-emerald-700/40 rounded-xl text-sm font-semibold transition-colors"
        >
          <Download className="w-4 h-4" /> {t('admin.backup')}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-amber-700/30 hover:bg-amber-700/50 text-amber-300 border border-amber-700/40 rounded-xl text-sm font-semibold transition-colors"
        >
          <Upload className="w-4 h-4" /> {t('admin.restore')}
        </button>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
      </div>

      {restoreResult && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-semibold border ${restoreResult.ok ? 'bg-emerald-900/40 border-emerald-700/40 text-emerald-300' : 'bg-red-900/40 border-red-700/40 text-red-300'}`}>
          {restoreResult.ok
            ? t('admin.restore_result', { created: restoreResult.created, updated: restoreResult.updated, errors: restoreResult.errors })
            : t('admin.restore_error')}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.search')}
          className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Users table (card list on mobile) */}
      <div className="space-y-3">
        {filtered.map(user => (
          <div key={user.id} className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-white text-base">{user.username}</div>
                <div className="text-xs text-slate-500 mt-0.5">{t('admin.joined')}: {new Date(user.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setBonusUser(user); setBonusAmount(0); }}
                  className="p-2 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 transition-colors"
                  title={t('admin.award_bonuses')}
                >
                  <Gem className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openEdit(user)}
                  className="p-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 transition-colors"
                  title={t('admin.edit')}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(user)}
                  className="p-2 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 transition-colors"
                  title={t('admin.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'ELO', val: user.rating, color: 'text-yellow-400' },
                { label: t('admin.wins'), val: user.wins, color: 'text-green-400' },
                { label: t('admin.losses'), val: user.losses, color: 'text-red-400' },
                { label: t('admin.bonuses'), val: user.bonuses, color: 'text-purple-400' },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-slate-900/60 rounded-lg py-1.5">
                  <div className={`text-sm font-bold ${color}`}>{val}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Edit modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-bold text-white text-lg">{t('admin.edit')}: {editUser.username}</h2>
              <button onClick={() => setEditUser(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {[
                { key: 'wins', label: 'Wins' },
                { key: 'losses', label: 'Losses' },
                { key: 'draws', label: 'Draws' },
                { key: 'rating', label: 'Rating (ELO)' },
                { key: 'bonuses', label: 'Bonuses' },
                { key: 'totalGames', label: 'Total Games' },
              ].map(({ key, label }) => (
                <div key={key} className="flex justify-between items-center">
                  <label className="text-sm text-slate-400">{label}</label>
                  <input
                    type="number"
                    value={editData[key] ?? 0}
                    onChange={e => setEditData(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="text-sm text-slate-400 block mb-1">{t('admin.new_password')}</label>
                <input
                  type="password"
                  value={editData.newPassword || ''}
                  onChange={e => setEditData(prev => ({ ...prev, newPassword: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditUser(null)} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold text-sm">
                {t('admin.cancel')}
              </button>
              <button onClick={handleSaveEdit} disabled={saving} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                <Check className="w-4 h-4" /> {t('admin.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore confirmation modal */}
      {restoreData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-bold text-white text-lg">{t('admin.restore_title')}</h2>
              <button onClick={() => setRestoreData(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {restoreData.error ? (
              <p className="text-red-400 text-sm mb-5">{t('admin.restore_error')}</p>
            ) : (
              <>
                <p className="text-slate-300 text-sm mb-4">
                  {t('admin.restore_info', {
                    date: restoreData.exportedAt ? new Date(restoreData.exportedAt).toLocaleDateString() : '?',
                    count: restoreData.userCount ?? restoreData.users?.length ?? 0
                  })}
                </p>
                <label className="flex items-center gap-3 cursor-pointer mb-5">
                  <input
                    type="checkbox"
                    checked={restorePasswords}
                    onChange={e => setRestorePasswords(e.target.checked)}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="text-sm text-slate-300">{t('admin.restore_passwords')}</span>
                </label>
              </>
            )}
            <div className="flex gap-3">
              <button onClick={() => setRestoreData(null)} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold text-sm">
                {t('admin.cancel')}
              </button>
              {!restoreData.error && (
                <button onClick={handleRestore} disabled={restoring} className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4" /> {t('admin.restore_confirm')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Award bonuses modal */}
      {bonusUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-bold text-white text-lg">{t('admin.award_bonuses')}: {bonusUser.username}</h2>
              <button onClick={() => setBonusUser(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="mb-4">
              <label className="text-sm text-slate-400 block mb-2">{t('admin.amount')}</label>
              <input
                type="number"
                value={bonusAmount}
                onChange={e => setBonusAmount(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBonusUser(null)} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold text-sm">
                {t('admin.cancel')}
              </button>
              <button onClick={handleAwardBonuses} disabled={saving} className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                <Gem className="w-4 h-4" /> {t('admin.apply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
