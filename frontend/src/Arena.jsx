import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const EMPTY_INPUT = Object.freeze({ forward: false, backward: false, left: false, right: false, fire: false });
const KEY_TO_INPUT = Object.freeze({
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'fire',
});

function colorForPlayer(id, isLocal) {
  if (isLocal) return '#c9f25b';
  let hash = 0;
  for (const character of String(id)) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 72% 62%)`;
}

function drawArena(canvas, state, playerId) {
  if (!canvas || !state?.arena) return;
  const context = canvas.getContext('2d');
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
  const pixelHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.fillStyle = '#0a100d';
  context.fillRect(0, 0, bounds.width, bounds.height);

  const scale = Math.min(bounds.width / state.arena.width, bounds.height / state.arena.height);
  const offsetX = (bounds.width - state.arena.width * scale) / 2;
  const offsetY = (bounds.height - state.arena.height * scale) / 2;

  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  context.fillStyle = '#101913';
  context.fillRect(0, 0, state.arena.width, state.arena.height);

  context.strokeStyle = 'rgba(201, 242, 91, 0.08)';
  context.lineWidth = 1 / scale;
  for (let x = 0; x <= state.arena.width; x += 50) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, state.arena.height);
    context.stroke();
  }
  for (let y = 0; y <= state.arena.height; y += 50) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(state.arena.width, y);
    context.stroke();
  }

  context.strokeStyle = 'rgba(201, 242, 91, 0.42)';
  context.lineWidth = 3;
  context.strokeRect(1.5, 1.5, state.arena.width - 3, state.arena.height - 3);

  for (const projectile of state.projectiles) {
    context.beginPath();
    context.arc(projectile.x, projectile.y, 5, 0, Math.PI * 2);
    context.fillStyle = projectile.ownerId === playerId ? '#f4ffb8' : '#ff9a70';
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 12;
    context.fill();
    context.shadowBlur = 0;
  }

  for (const player of state.players) {
    const isLocal = player.id === playerId;
    const color = colorForPlayer(player.id, isLocal);
    if (!player.alive) {
      context.fillStyle = 'rgba(255, 255, 255, 0.55)';
      context.font = '600 14px system-ui';
      context.textAlign = 'center';
      context.fillText(`${player.username} respawning`, player.x, player.y);
      continue;
    }

    context.save();
    context.translate(player.x, player.y);
    context.rotate(player.rotation);
    context.fillStyle = '#253126';
    context.strokeStyle = color;
    context.lineWidth = isLocal ? 4 : 3;
    context.fillRect(-24, -17, 48, 34);
    context.strokeRect(-24, -17, 48, 34);
    context.fillStyle = color;
    context.fillRect(-29, -20, 7, 40);
    context.fillRect(22, -20, 7, 40);
    context.beginPath();
    context.arc(0, 0, 11, 0, Math.PI * 2);
    context.fill();
    context.fillRect(5, -4, 34, 8);
    context.restore();

    const barWidth = 58;
    context.fillStyle = 'rgba(0, 0, 0, 0.65)';
    context.fillRect(player.x - barWidth / 2, player.y - 43, barWidth, 6);
    context.fillStyle = player.health > 40 ? '#c9f25b' : '#ff7a45';
    context.fillRect(player.x - barWidth / 2, player.y - 43, barWidth * (player.health / player.maxHealth), 6);
    context.fillStyle = isLocal ? '#f2ffd4' : '#e1e8dd';
    context.font = `${isLocal ? '700' : '600'} 14px system-ui`;
    context.textAlign = 'center';
    context.fillText(player.username, player.x, player.y - 50);
  }

  context.restore();
}

export default function Arena({ username, onLeave }) {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const inputRef = useRef({ ...EMPTY_INPUT });
  const stateRef = useRef(null);
  const frameRef = useRef(null);
  const [playerId, setPlayerId] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [message, setMessage] = useState('Connecting to the arena…');

  useEffect(() => {
    const socket = io({
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnection('connected');
      setMessage('Connected');
      socket.emit('player:input', inputRef.current);
    });
    socket.on('game:welcome', ({ playerId: id }) => setPlayerId(id));
    socket.on('game:state', (nextState) => {
      stateRef.current = nextState;
      setGameState(nextState);
    });
    socket.on('disconnect', (reason) => {
      setConnection(reason === 'io server disconnect' ? 'disconnected' : 'reconnecting');
      setMessage(reason === 'io server disconnect' ? 'Disconnected by the server' : 'Connection lost — reconnecting…');
    });
    socket.on('connect_error', (error) => {
      setConnection('error');
      setMessage(error.message?.includes('Authentication') ? 'Session expired. Leave and log in again.' : 'Unable to connect to the arena.');
    });
    socket.on('session:replaced', () => {
      setConnection('error');
      setMessage('This account joined the arena from another tab.');
    });
    socket.on('game:error', (error) => {
      setConnection('error');
      setMessage(error?.message ?? 'Arena error');
    });

    // Refresh held controls so the server can safely stop stale input after a
    // dropped connection without interrupting a key held for several seconds.
    const inputHeartbeat = window.setInterval(() => {
      if (socket.connected) socket.emit('player:input', inputRef.current);
    }, 500);

    return () => {
      window.clearInterval(inputHeartbeat);
      socket.emit('player:input', EMPTY_INPUT);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    function updateInput(event, pressed) {
      const inputName = KEY_TO_INPUT[event.code];
      const targetName = event.target?.tagName;
      if (!inputName || ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetName)) return;
      event.preventDefault();
      if (inputRef.current[inputName] === pressed) return;
      inputRef.current = { ...inputRef.current, [inputName]: pressed };
      socketRef.current?.emit('player:input', inputRef.current);
    }
    const keyDown = (event) => updateInput(event, true);
    const keyUp = (event) => updateInput(event, false);
    const releaseAll = () => {
      inputRef.current = { ...EMPTY_INPUT };
      socketRef.current?.emit('player:input', inputRef.current);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', releaseAll);
    };
  }, []);

  useEffect(() => {
    const render = () => {
      drawArena(canvasRef.current, stateRef.current, playerId);
      frameRef.current = window.requestAnimationFrame(render);
    };
    frameRef.current = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameRef.current);
  }, [playerId]);

  const sortedPlayers = useMemo(
    () => [...(gameState?.players ?? [])].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username)),
    [gameState],
  );
  const localPlayer = sortedPlayers.find((player) => player.id === playerId);
  const leaders = sortedPlayers.filter((player) => gameState?.leaders?.includes(player.id));
  const leaderText = leaders.length === 0
    ? 'Waiting for players'
    : leaders[0].score === 0 || leaders.length > 1
      ? 'Battle tied'
      : `${leaders[0].username} leads with ${leaders[0].score}`;

  return (
    <main className="game-screen">
      <header className="game-topbar">
        <div>
          <span className="game-kicker">Tank Battle Arena</span>
          <strong>{leaderText}</strong>
        </div>
        <div className={`connection-state connection-${connection}`} role="status">
          <span aria-hidden="true" /> {message}
        </div>
        <button type="button" className="leave-button" onClick={onLeave}>Leave arena</button>
      </header>

      <section className="game-layout">
        <div className="canvas-shell">
          <canvas ref={canvasRef} className="game-canvas" aria-label="Live multiplayer tank battlefield" />
          {!localPlayer?.alive && localPlayer && (
            <div className="respawn-banner">Tank destroyed · Respawning in {Math.ceil(localPlayer.respawnIn / 1000)}</div>
          )}
          {connection !== 'connected' && <div className="connection-overlay">{message}</div>}
        </div>

        <aside className="game-sidebar" aria-label="Match information">
          <section className="pilot-card">
            <span className="panel-label">Your tank</span>
            <h1>{username}</h1>
            <div className="health-row">
              <span>Armor</span>
              <strong>{localPlayer?.health ?? 0} / {localPlayer?.maxHealth ?? 100}</strong>
            </div>
            <div className="health-meter"><span style={{ width: `${localPlayer?.health ?? 0}%` }} /></div>
            <div className="pilot-score"><span>Eliminations</span><strong>{localPlayer?.score ?? 0}</strong></div>
          </section>

          <section className="scoreboard">
            <div className="scoreboard-title"><span className="panel-label">Live standings</span><span>{sortedPlayers.length} online</span></div>
            <ol>
              {sortedPlayers.map((player, index) => (
                <li key={player.id} className={player.id === playerId ? 'is-local' : ''}>
                  <span className="score-rank">{index + 1}</span>
                  <span className="score-name">{player.username}{gameState?.leaders?.includes(player.id) && player.score > 0 ? ' · Leader' : ''}</span>
                  <strong>{player.score}</strong>
                </li>
              ))}
            </ol>
          </section>

          <section className="controls-card">
            <span className="panel-label">Controls</span>
            <div><kbd>W</kbd><span>Forward</span></div>
            <div><kbd>S</kbd><span>Reverse</span></div>
            <div><kbd>A</kbd><kbd>D</kbd><span>Rotate</span></div>
            <div><kbd className="space-key">Space</kbd><span>Fire</span></div>
          </section>
        </aside>
      </section>
    </main>
  );
}
