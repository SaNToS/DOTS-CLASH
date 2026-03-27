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
    if (typeof username !== 'string' || username.length < 2 || username.length > 24)
      return res.status(400).json({ error: 'Username must be 2–24 characters' });
    if (!/^[a-zA-Z0-9_\-а-яА-ЯёЁіІїЇєЄ]+$/.test(username))
      return res.status(400).json({ error: 'Username contains invalid characters' });
    if (typeof password !== 'string' || password.length < 4)
      return res.status(400).json({ error: 'Password too short' });

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'Username taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash }
    });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
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

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
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


// GET game record by roomId
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
