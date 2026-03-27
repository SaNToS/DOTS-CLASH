const createGame = (boardSize, players, firstPlayer = 0) => {
  // 0 = empty, 1 = P1 dots, 2 = P2 dots, 3 = P1 territory, 4 = P2 territory
  const board = Array.from({ length: boardSize }, () => Array(boardSize).fill(0));

  return {
    boardSize,
    board,
    turn: firstPlayer,
    passes: 0,
    score: [0, 0], // [P1 score, P2 score]
    history: []
  };
};

const hasMovesLeft = (game) => {
  for (let y = 0; y < game.boardSize; y++) {
    for (let x = 0; x < game.boardSize; x++) {
      if (game.board[y][x] === 0) return true;
    }
  }
  return false;
};

const processMove = (game, x, y, playerIndex, patternKey = null) => {
  if (x < 0 || x >= game.boardSize || y < 0 || y >= game.boardSize) {
    return { success: false, reason: 'Out of bounds' };
  }
  
  if (game.board[y][x] !== 0) {
    return { success: false, reason: 'Cell occupied' };
  }

  // Snapshot before applying move (for undo)
  const boardSnapshot = game.board.map(row => [...row]);
  const scoreSnapshot = [...game.score];

  // Place the dot
  const playerDot = playerIndex + 1; // 1 or 2
  game.board[y][x] = playerDot;
  game.passes = 0; // reset passes

  // Detect captures
  const captureResult = detectCaptures(game, playerIndex, { x, y });

  // Next turn
  game.turn = game.turn === 0 ? 1 : 0;
  game.history.push({ x, y, playerIndex, captures: captureResult.captures, pattern: patternKey, boardSnapshot, scoreSnapshot });

  return { 
    success: true, 
    captures: captureResult.captures,
    territories: captureResult.territories,
    contourPaths: captureResult.contourPaths
  };
};

const passTurn = (game) => {
  game.passes += 1;
  game.turn = game.turn === 0 ? 1 : 0;
};

/**
 * Compute contour path: find the boundary dots of the capturing player 
 * that surround a captured territory, ordered as a closed loop starting 
 * from the dot nearest to `startPos`.
 */
const computeContourPath = (board, territoryCells, playerDot, boardSize, startPos) => {
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const terrSet = new Set(territoryCells.map(c => `${c.x},${c.y}`));
  const boundarySet = new Set();
  const boundaryDots = [];

  // Find all player dots adjacent (8-dir) to any territory cell
  for (const cell of territoryCells) {
    for (const [dx, dy] of dirs) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
        if (board[ny][nx] === playerDot && !terrSet.has(`${nx},${ny}`)) {
          const key = `${nx},${ny}`;
          if (!boundarySet.has(key)) {
            boundarySet.add(key);
            boundaryDots.push({ x: nx, y: ny });
          }
        }
      }
    }
  }

  if (boundaryDots.length < 2) return boundaryDots;

  // Order boundary dots into a contour loop using nearest-neighbor walk
  // Start from the dot closest to startPos
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const used = new Set();

  // Find starting dot (nearest to the last placed move)
  let startIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < boundaryDots.length; i++) {
    const d = dist2(boundaryDots[i], startPos);
    if (d < minDist) { minDist = d; startIdx = i; }
  }

  const ordered = [boundaryDots[startIdx]];
  used.add(`${boundaryDots[startIdx].x},${boundaryDots[startIdx].y}`);

  while (ordered.length < boundaryDots.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < boundaryDots.length; i++) {
      const key = `${boundaryDots[i].x},${boundaryDots[i].y}`;
      if (used.has(key)) continue;
      const d = dist2(last, boundaryDots[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    used.add(`${boundaryDots[bestIdx].x},${boundaryDots[bestIdx].y}`);
    ordered.push(boundaryDots[bestIdx]);
  }

  return ordered;
};

const detectCaptures = (game, playerIndex, lastMovePos) => {
  const size = game.boardSize;
  const board = game.board;
  const p = playerIndex + 1; // 1 or 2
  const opp = p === 1 ? 2 : 1;
  const p_terr = p === 1 ? 3 : 4;
  
  const escaped = Array.from({ length: size }, () => Array(size).fill(false));
  const queue = [];

  // 1. Flood fill from borders to find all cells that can reach the outside
  // stepping over anything that is NOT `p` (the player's alive dots)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x === 0 || x === size - 1 || y === 0 || y === size - 1) {
        if (board[y][x] !== p && !escaped[y][x]) {
          escaped[y][x] = true;
          queue.push({x, y});
        }
      }
    }
  }

  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]]; // 4-directional escape
  
  let head = 0;
  while (head < queue.length) {
    const {x, y} = queue[head++];
    
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
        if (!escaped[ny][nx] && board[ny][nx] !== p) {
          escaped[ny][nx] = true;
          queue.push({x: nx, y: ny});
        }
      }
    }
  }

  // 2. Identify enclosed regions
  const visited = Array.from({ length: size }, () => Array(size).fill(false));
  const newTerritories = [];
  const newlyCapturedEnemies = [];
  const contourPaths = [];
  let scoreGained = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!escaped[y][x] && board[y][x] !== p && !visited[y][x]) {
        // Start discovering an enclosed component
        const compQueue = [{x, y}];
        visited[y][x] = true;
        const componentCells = [];
        let hasEnemy = false;
        
        let cHead = 0;
        while (cHead < compQueue.length) {
          const curr = compQueue[cHead++];
          componentCells.push(curr);
          
          if (board[curr.y][curr.x] === opp) {
            hasEnemy = true;
          }
          
          for (const [dx, dy] of dirs) {
            const nx = curr.x + dx;
            const ny = curr.y + dy;
            
            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
              if (!escaped[ny][nx] && board[ny][nx] !== p && !visited[ny][nx]) {
                visited[ny][nx] = true;
                compQueue.push({x: nx, y: ny});
              }
            }
          }
        }
        
        // If it contains an enemy, we capture the whole component
        if (hasEnemy) {
          const compTerritory = [];
          for (const cell of componentCells) {
            if (board[cell.y][cell.x] === opp) {
              scoreGained++;
              newlyCapturedEnemies.push({x: cell.x, y: cell.y});
            }
            board[cell.y][cell.x] = p_terr;
            compTerritory.push({x: cell.x, y: cell.y});
          }
          newTerritories.push(compTerritory);

          // Compute contour path for this territory
          const contour = computeContourPath(board, compTerritory, p, size, lastMovePos || { x: 0, y: 0 });
          contourPaths.push(contour);
        }
      }
    }
  }

  game.score[playerIndex] += scoreGained;

  return {
    captures: newlyCapturedEnemies,
    territories: newTerritories,
    contourPaths
  };
};


const undoMove = (game) => {
  if (game.history.length === 0) return { success: false };
  const last = game.history.pop();
  game.board = last.boardSnapshot;
  game.score = last.scoreSnapshot;
  game.turn = last.playerIndex;
  game.passes = 0;
  return { success: true, playerIndex: last.playerIndex };
};

module.exports = {
  createGame,
  processMove,
  hasMovesLeft,
  passTurn,
  detectCaptures,
  undoMove
};
