const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma/db');

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
          updated++;
        } else {
          // Require a valid password hash for new accounts
          if (!u.passwordHash) { errors++; continue; }
          await prisma.user.create({
            data: {
              username:     u.username,
              passwordHash: u.passwordHash,
              wins:         Number(u.wins       ?? 0),
              losses:       Number(u.losses     ?? 0),
              draws:        Number(u.draws      ?? 0),
              rating:       Number(u.rating     ?? 1200),
              totalGames:   Number(u.totalGames ?? 0),
              timePlayed:   Number(u.timePlayed ?? 0),
              bonuses:      Number(u.bonuses    ?? 0),
            }
          });
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

module.exports = router;
