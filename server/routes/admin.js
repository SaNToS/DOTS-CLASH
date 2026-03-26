const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/db');

const BOT_MEMORY_FILE  = path.join(__dirname, '..', 'botMemory.json');
const TRAIN_STATS_FILE = path.join(__dirname, '..', 'trainStats.json');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_dots_key';

// Comma-separated list of admin usernames in .env: ADMIN_USERNAMES=alex,admin
const isAdmin = (username) => {
  const list = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(username.toLowerCase());
};

const requireAdmin = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = jwt.verify(token, JWT_SECRET);
    if (!isAdmin(payload.username)) return res.status(403).json({ error: 'Forbidden' });
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Check admin access
router.get('/check', requireAdmin, (req, res) => {
  res.json({ ok: true, username: req.admin.username });
});

// List all users with full stats
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, username: true,
        wins: true, losses: true, draws: true,
        rating: true, totalGames: true, timePlayed: true,
        bonuses: true, createdAt: true
      }
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Award/deduct bonuses
router.post('/users/:id/bonuses', requireAdmin, async (req, res) => {
  try {
    const { amount } = req.body; // positive = award, negative = deduct
    if (typeof amount !== 'number') return res.status(400).json({ error: 'amount must be a number' });
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { bonuses: { increment: amount } },
      select: { id: true, username: true, bonuses: true }
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit user stats / bonuses (full override)
router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { wins, losses, draws, rating, bonuses, totalGames, timePlayed, newPassword } = req.body;
    const data = {};
    if (wins !== undefined) data.wins = wins;
    if (losses !== undefined) data.losses = losses;
    if (draws !== undefined) data.draws = draws;
    if (rating !== undefined) data.rating = rating;
    if (bonuses !== undefined) data.bonuses = bonuses;
    if (totalGames !== undefined) data.totalGames = totalGames;
    if (timePlayed !== undefined) data.timePlayed = timePlayed;
    if (newPassword) data.passwordHash = await bcrypt.hash(newPassword, 10);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, username: true, wins: true, losses: true, draws: true, rating: true, bonuses: true, totalGames: true, timePlayed: true }
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Backup: export all users as JSON ─────────────────────────────────────
router.get('/backup', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, username: true, passwordHash: true,
        wins: true, losses: true, draws: true,
        rating: true, totalGames: true, timePlayed: true,
        bonuses: true, createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      userCount: users.length,
      users
    };

    const filename = `dots_backup_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Restore: upsert users from backup JSON ────────────────────────────────
// Body: { users: [...], restorePasswords: boolean }
// Existing users → update stats (and optionally password hash)
// New users       → create with all fields from backup
router.post('/restore', requireAdmin, async (req, res) => {
  try {
    const { users, restorePasswords = false } = req.body;
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'Invalid backup: users array is empty or missing' });
    }

    let created = 0, updated = 0, errors = 0;

    for (const u of users) {
      if (!u.username) { errors++; continue; }
      try {
        const existing = await prisma.user.findUnique({ where: { username: u.username } });

        if (existing) {
          const data = {
            wins:       Number(u.wins       ?? existing.wins),
            losses:     Number(u.losses     ?? existing.losses),
            draws:      Number(u.draws      ?? existing.draws),
            rating:     Number(u.rating     ?? existing.rating),
            totalGames: Number(u.totalGames ?? existing.totalGames),
            timePlayed: Number(u.timePlayed ?? existing.timePlayed),
            bonuses:    Number(u.bonuses    ?? existing.bonuses),
          };
          if (restorePasswords && u.passwordHash) data.passwordHash = u.passwordHash;
          await prisma.user.update({ where: { username: u.username }, data });
          // If ID changed (DB was reset), log for info but don't block
          if (u.id && existing.id !== u.id) {
            console.log(`Restore: user "${u.username}" ID mismatch (backup: ${u.id}, current: ${existing.id}) — existing JWT tokens may be invalid`);
          }
          updated++;
        } else {
          // Require a valid password hash for new accounts
          if (!u.passwordHash) { errors++; continue; }
          const createData = {
            username:     u.username,
            passwordHash: u.passwordHash,
            wins:         Number(u.wins       ?? 0),
            losses:       Number(u.losses     ?? 0),
            draws:        Number(u.draws      ?? 0),
            rating:       Number(u.rating     ?? 1200),
            totalGames:   Number(u.totalGames ?? 0),
            timePlayed:   Number(u.timePlayed ?? 0),
            bonuses:      Number(u.bonuses    ?? 0),
          };
          // Preserve original ID so existing JWT tokens remain valid
          if (u.id) createData.id = u.id;
          await prisma.user.create({ data: createData });
          created++;
        }
      } catch (e) {
        console.error(`Restore: error processing user "${u.username}":`, e.message);
        errors++;
      }
    }

    res.json({ ok: true, created, updated, errors, total: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bot Memory: download ───────────────────────────────────────────────────
router.get('/bot-memory', requireAdmin, (req, res) => {
  try {
    const raw = fs.existsSync(BOT_MEMORY_FILE)
      ? fs.readFileSync(BOT_MEMORY_FILE, 'utf8')
      : JSON.stringify({ botPatterns: {}, humanPatterns: {}, gamesPlayed: 0, wins: 0, losses: 0 });
    const data = JSON.parse(raw);

    // Attach train stats if available
    let trainStats = null;
    if (fs.existsSync(TRAIN_STATS_FILE)) {
      try { trainStats = JSON.parse(fs.readFileSync(TRAIN_STATS_FILE, 'utf8')); } catch {}
    }

    const filename = `botMemory_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json({ ...data, _trainStats: trainStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bot Memory: stats only (for UI display) ────────────────────────────────
router.get('/bot-memory/stats', requireAdmin, (req, res) => {
  try {
    let memory = { botPatterns: {}, humanPatterns: {}, gamesPlayed: 0, wins: 0, losses: 0 };
    if (fs.existsSync(BOT_MEMORY_FILE)) {
      try { memory = JSON.parse(fs.readFileSync(BOT_MEMORY_FILE, 'utf8')); } catch {}
    }
    let trainStats = null;
    if (fs.existsSync(TRAIN_STATS_FILE)) {
      try { trainStats = JSON.parse(fs.readFileSync(TRAIN_STATS_FILE, 'utf8')); } catch {}
    }
    res.json({
      gamesPlayed:    memory.gamesPlayed   || 0,
      wins:           memory.wins          || 0,
      losses:         memory.losses        || 0,
      botPatterns:    Object.keys(memory.botPatterns   || {}).length,
      humanPatterns:  Object.keys(memory.humanPatterns || {}).length,
      trainStats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bot Memory: restore from uploaded JSON ────────────────────────────────
router.post('/bot-memory', requireAdmin, (req, res) => {
  try {
    const { botPatterns, humanPatterns, gamesPlayed, wins, losses } = req.body;
    if (typeof botPatterns !== 'object' || typeof humanPatterns !== 'object') {
      return res.status(400).json({ error: 'Invalid bot memory format' });
    }
    const data = {
      botPatterns:   botPatterns   || {},
      humanPatterns: humanPatterns || {},
      gamesPlayed:   Number(gamesPlayed)  || 0,
      wins:          Number(wins)         || 0,
      losses:        Number(losses)       || 0,
    };
    fs.writeFileSync(BOT_MEMORY_FILE, JSON.stringify(data));
    // Invalidate in-memory cache so next bot move loads fresh data
    try {
      const botAI = require('../botAI');
      if (botAI.saveMemory) botAI.saveMemory(data);
    } catch {}
    res.json({ ok: true, botPatterns: Object.keys(data.botPatterns).length, humanPatterns: Object.keys(data.humanPatterns).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bot Memory: reset to defaults ─────────────────────────────────────────
router.delete('/bot-memory', requireAdmin, (req, res) => {
  try {
    const defaults = { botPatterns: {}, humanPatterns: {}, gamesPlayed: 0, wins: 0, losses: 0 };
    fs.writeFileSync(BOT_MEMORY_FILE, JSON.stringify(defaults));
    try {
      const botAI = require('../botAI');
      if (botAI.saveMemory) botAI.saveMemory(defaults);
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
