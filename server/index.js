require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const roomManager = require('./roomManager');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payment');

const app = express();

// CORS — allow only our frontend
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL || 'https://dotsclash.xyz',
  'http://localhost:5173',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  }
}));

// Simple in-memory rate limiter for auth endpoints (no extra packages)
const authAttempts = new Map();
const rateLimit = (maxReq, windowMs) => (req, res, next) => {
  const key = req.ip;
  const now = Date.now();
  const entry = authAttempts.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  authAttempts.set(key, entry);
  if (entry.count > maxReq) return res.status(429).json({ error: 'Too many requests, slow down' });
  next();
};
// Cleanup old entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of authAttempts) if (v.start < cutoff) authAttempts.delete(k);
}, 5 * 60 * 1000);

// Stripe webhook needs raw body — mount BEFORE express.json()
app.use('/api/payment', paymentRoutes);

app.use(express.json());

app.use('/api/auth/login', rateLimit(10, 60_000));    // 10 req/min
app.use('/api/auth/register', rateLimit(5, 60_000));  // 5 req/min
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes); // for leaderboard
app.use('/api/admin', adminRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', (data) => {
    roomManager.createRoom(socket, io, data);
  });

  socket.on('create_bot_room', (data) => {
    roomManager.createBotRoom(socket, io, data);
  });

  socket.on('join_room', (data) => {
    roomManager.joinRoom(socket, io, data);
  });

  socket.on('check_active_game', (data) => {
    roomManager.checkActiveGame(socket, data);
  });

  socket.on('find_match', (data) => {
    roomManager.findMatch(socket, io, data);
  });

  socket.on('cancel_match', () => {
    roomManager.cancelMatch(socket);
  });

  socket.on('get_room', (data) => {
    roomManager.getRoom(socket, io, data);
  });

  socket.on('make_move', (data) => {
    roomManager.handleMove(socket, io, data);
  });

  socket.on('pass_turn', (data) => {
    roomManager.handlePass(socket, io, data);
  });

  socket.on('offer_draw', (data) => {
    roomManager.handleDrawOffer(socket, io, data);
  });

  socket.on('accept_draw', (data) => {
    roomManager.handleDrawAccept(socket, io, data);
  });

  socket.on('decline_draw', () => {
    roomManager.handleDrawDecline(socket, io);
  });

  socket.on('undo_move', async () => {
    await roomManager.handleUndoMove(socket, io);
  });

  socket.on('resign', (data) => {
    roomManager.handleResign(socket, io, data);
  });

  socket.on('send_message', (data) => {
    roomManager.handleMessage(socket, io, data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    roomManager.handleDisconnect(socket, io);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (accessible from network)`);
});
