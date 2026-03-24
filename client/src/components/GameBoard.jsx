import { useEffect, useRef } from 'react';

// board matrix:
// 0: empty
// 1: P1 dot
// 2: P2 dot
// 3: P1 territory
// 4: P2 territory

export default function GameBoard({ boardSize, board, myPlayerIndex, turn, onMakeMove, players, pieceStyle, lastMove, playPopSound }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const prevLastMove = useRef(null);

  useEffect(() => {
    if (lastMove && prevLastMove.current) {
      if (lastMove.x !== prevLastMove.current.x || lastMove.y !== prevLastMove.current.y) {
        playPopSound?.();
      }
    } else if (lastMove && !prevLastMove.current) {
      playPopSound?.();
    }
    prevLastMove.current = lastMove;
  }, [lastMove, playPopSound]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      const rect = wrapper.getBoundingClientRect();
      // Fit the largest square into the available container
      const size = Math.min(rect.width, rect.height, 600);
      const dpr = window.devicePixelRatio || 1;

      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.scale(dpr, dpr);

      const width = size;
      const height = size;
      const padding = Math.max(16, size * 0.04);
      const gridAreaSize = width - padding * 2;
      const cellSize = gridAreaSize / (boardSize - 1);

      ctx.clearRect(0, 0, width, height);

      // Grid
      ctx.beginPath();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < boardSize; i++) {
        const x = padding + i * cellSize;
        const y = padding + i * cellSize;
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      const getCoords = (gx, gy) => ({
        x: padding + gx * cellSize,
        y: padding + gy * cellSize
      });

      const p1Color = players[0]?.color === 'red' ? '#ef4444' : '#3b82f6';
      const p2Color = players[1]?.color === 'red' ? '#ef4444' : '#3b82f6';

      const renderPiece = (x, y, playerValue, isLastMove) => {
        const { x: px, y: py } = getCoords(x, y);
        const isP1 = playerValue === 1;
        const color = isP1 ? p1Color : p2Color;
        const radius = Math.max(3, cellSize * 0.32);

        if (isLastMove) {
          ctx.beginPath();
          ctx.arc(px, py, radius * 1.5, 0, 2 * Math.PI);
          ctx.fillStyle = color + '40';
          ctx.fill();
        }

        const style = pieceStyle || 'dots';
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, cellSize * 0.08);

        if (style === 'crosses' && !isP1) {
          ctx.beginPath();
          ctx.moveTo(px - radius, py - radius);
          ctx.lineTo(px + radius, py + radius);
          ctx.moveTo(px + radius, py - radius);
          ctx.lineTo(px - radius, py + radius);
          ctx.stroke();
        } else if (style === 'crosses' && isP1) {
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, 2 * Math.PI);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, 2 * Math.PI);
          ctx.fill();
        }
      };

      const renderTerritory = (x, y, territoryValue) => {
        const { x: px, y: py } = getCoords(x, y);
        const isP1 = territoryValue === 3;
        const color = isP1 ? p1Color : p2Color;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(px - cellSize / 2, py - cellSize / 2, cellSize, cellSize);
        ctx.globalAlpha = 1.0;
      };

      if (board) {
        for (let y = 0; y < boardSize; y++) {
          for (let x = 0; x < boardSize; x++) {
            const val = board[y][x];
            if (val === 3 || val === 4) renderTerritory(x, y, val);
          }
        }
        for (let y = 0; y < boardSize; y++) {
          for (let x = 0; x < boardSize; x++) {
            const val = board[y][x];
            if (val === 1 || val === 2) {
              renderPiece(x, y, val, lastMove?.x === x && lastMove?.y === y);
            }
          }
        }
      }
    };

    draw();

    const ro = new ResizeObserver(draw);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [board, boardSize, players, pieceStyle, lastMove]);

  const handleClick = (e) => {
    if (turn !== myPlayerIndex) return;
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const size = parseFloat(canvas.style.width) || canvas.clientWidth;
    const padding = Math.max(16, size * 0.04);
    const cellSize = (size - padding * 2) / (boardSize - 1);

    const gridX = Math.round((x - padding) / cellSize);
    const gridY = Math.round((y - padding) / cellSize);

    if (gridX >= 0 && gridX < boardSize && gridY >= 0 && gridY < boardSize) {
      if (board && board[gridY][gridX] === 0) {
        onMakeMove(gridX, gridY);
      }
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full flex items-center justify-center"
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="cursor-crosshair notebook-bg rounded-lg border-2 border-slate-300 shadow-inner block"
      />
    </div>
  );
}
