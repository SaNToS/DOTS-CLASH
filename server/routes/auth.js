const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_dots_key';

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'Username taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash }
    });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
    res.json({ token, username });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
    res.json({ token, username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: [{ rating: 'desc' }, { wins: 'desc' }],
      take: 20,
      select: { username: true, wins: true, losses: true, draws: true, rating: true, totalGames: true, timePlayed: true }
    });
    res.json(users);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.json([]);
  }
});

// GET own bonus count (requires auth token in header)
router.get('/bonuses', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { bonuses: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ bonuses: user.bonuses });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Purchase bonus pack (mock — no real payment; integrate payment gateway here)
router.post('/bonuses/purchase', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, JWT_SECRET);
    const { pack } = req.body; // 'small'|'medium'|'large'
    const amounts = { small: 5, medium: 20, large: 50 };
    const amount = amounts[pack];
    if (!amount) return res.status(400).json({ error: 'Invalid pack' });
    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { bonuses: { increment: amount } },
      select: { bonuses: true }
    });
    res.json({ bonuses: user.bonuses, added: amount });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.get('/game/:roomId', async (req, res) => {
  try {
    const record = await prisma.gameRecord.findUnique({ where: { roomId: req.params.roomId } });
    if (!record) return res.status(404).json({ error: 'Game not found' });
    res.json(record);
  } catch (err) {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
