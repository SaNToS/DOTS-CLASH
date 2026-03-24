# Dots Game (Точки)

A full-stack real-time multiplayer implementation of the classic pen-and-paper game "Dots".

## Features
- **Real-time Multiplayer:** Play against your friends instantly using Socket.io.
- **Server-Authoritative Logic:** The server validates all moves and detects captured territories securely.
- **Auto Capture Detection:** Simply surround your opponent's dots and the server handles the flood-fill capture algorithm.
- **Robust Reconnection:** Accidentally refreshed? You can join back into your active game.
- **Chat & Controls:** In-game chat, Pass turn, Resign, and timeout defenses (60s disconnect win).

## Project Structure
- `/server` - Node.js Express & Socket.io Backend
- `/client` - React & Vite Frontend with Tailwind CSS

## Game Rules
Two players take turns placing their dots on the grid intersections. The goal is to completely surround your opponent's dots with a closed loop of your own dots. Surrounded enemy dots are captured and add to your score. The player with the most captured dots at the end wins!

## Instructions to Run

1. **Clone or Download** the repository.
2. **Setup Server:**
   ```bash
   cd server
   npm install
   npm run dev
   ```
3. **Setup Client:**
   ```bash
   cd client
   npm install
   npm run dev
   ```
4. **Play:**
   Open the frontend URL (usually `http://localhost:5173`) in two different browser windows to play against yourself or share the Room Code with a friend!

## Environment Variables
Copy `.env.example` to `.env` in both `server` and `client` folders if you want to customize the ports and server URLs.

- **Server:** `PORT` (default: 3001)
- **Client:** `VITE_SERVER_URL` (default: http://localhost:3001)
