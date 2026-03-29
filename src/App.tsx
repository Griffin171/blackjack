import { useState, useRef, useEffect, useCallback } from 'react';
import Peer from 'peerjs';
import { PublicGameState } from './types';
import {
  genRoomCode,
  initHostState,
  doHit,
  doStand,
  toPublicState,
} from './game/engine';
import type { HostState } from './game/engine';
import CardView from './components/CardView';

const PEER_PREFIX = 'bj21game-';

interface ConnectedPlayer {
  id: string;
  name: string;
  conn: any; // PeerJS DataConnection - null for host
}

export default function App() {
  const [screen, setScreen] = useState<'home' | 'lobby' | 'game'>('home');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('bj-name') || '');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [myIndex, setMyIndex] = useState(-1);
  const [lobbyPlayers, setLobbyPlayers] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, [number, number, number]>>({});

  const peerRef = useRef<Peer | null>(null);
  const hostStateRef = useRef<HostState | null>(null);
  const connPlayersRef = useRef<ConnectedPlayer[]>([]);
  const roomCodeRef = useRef('');
  const hostConnRef = useRef<any>(null);
  const scoresRef = useRef<Record<string, [number, number, number]>>({});

  // Save name
  useEffect(() => {
    if (playerName) localStorage.setItem('bj-name', playerName);
  }, [playerName]);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    hostStateRef.current = null;
    connPlayersRef.current = [];
    hostConnRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // ═══════════════════════════════════════
  // HOST: Broadcast state to all players
  // ═══════════════════════════════════════
  const broadcastState = useCallback(() => {
    if (!hostStateRef.current) return;
    const pub = toPublicState(hostStateRef.current, roomCodeRef.current);

    // Update local (host is index 0)
    setGameState(pub);
    setMyIndex(0);

    // Send to each client
    for (const cp of connPlayersRef.current) {
      if (cp.conn) {
        const idx = hostStateRef.current!.players.findIndex(p => p.id === cp.id);
        try {
          cp.conn.send({ type: 'state', state: pub, yourIndex: idx });
        } catch (_e) { /* ignore send errors */ }
      }
    }
  }, []);

  // ═══════════════════════════════════════
  // HOST: Update lobby player list
  // ═══════════════════════════════════════
  const updateLobbyList = useCallback(() => {
    const names = connPlayersRef.current.map(p => p.name);
    setLobbyPlayers([...names]);
    for (const cp of connPlayersRef.current) {
      if (cp.conn) {
        try {
          cp.conn.send({ type: 'lobby', players: names });
        } catch (_e) { /* ignore */ }
      }
    }
  }, []);

  // ═══════════════════════════════════════
  // HOST: Update scores after round
  // ═══════════════════════════════════════
  const updateScores = useCallback(() => {
    if (!hostStateRef.current || hostStateRef.current.status !== 'finished') return;
    const s = { ...scoresRef.current };
    for (const player of hostStateRef.current.players) {
      if (!s[player.name]) s[player.name] = [0, 0, 0];
      const r = hostStateRef.current.results[player.id];
      if (r === 'win' || r === 'blackjack') s[player.name][0]++;
      else if (r === 'lose') s[player.name][1]++;
      else if (r === 'push') s[player.name][2]++;
    }
    scoresRef.current = s;
    setScores({ ...s });
  }, []);

  // ═══════════════════════════════════════
  // HOST: Handle action from a client
  // ═══════════════════════════════════════
  const handleClientAction = useCallback((fromId: string, action: string) => {
    if (!hostStateRef.current || hostStateRef.current.status !== 'playing') return;
    const playerIdx = hostStateRef.current.players.findIndex(p => p.id === fromId);
    if (playerIdx === -1 || playerIdx !== hostStateRef.current.currentPlayerIndex) return;

    if (action === 'hit') {
      hostStateRef.current = doHit(hostStateRef.current, playerIdx);
    } else if (action === 'stand') {
      hostStateRef.current = doStand(hostStateRef.current, playerIdx);
    }
    broadcastState();
    if (hostStateRef.current.status === 'finished') {
      updateScores();
    }
  }, [broadcastState, updateScores]);

  // ═══════════════════════════════════════
  // HOST: Create Room
  // ═══════════════════════════════════════
  const createRoom = useCallback(() => {
    if (!playerName.trim()) { setError('Digite seu nome!'); return; }
    setLoading(true);
    setError('');

    const code = genRoomCode();
    roomCodeRef.current = code;
    setRoomCode(code);

    const peer = new Peer(PEER_PREFIX + code);
    peerRef.current = peer;

    peer.on('open', () => {
      setLoading(false);
      setIsHost(true);
      setScreen('lobby');
      connPlayersRef.current = [{ id: 'host', name: playerName.trim(), conn: null }];
      updateLobbyList();
    });

    peer.on('connection', (conn: any) => {
      conn.on('data', (data: any) => {
        if (data.type === 'join') {
          const cp: ConnectedPlayer = {
            id: data.id || conn.peer,
            name: data.name,
            conn,
          };
          connPlayersRef.current = [...connPlayersRef.current, cp];
          updateLobbyList();
        } else if (data.type === 'action') {
          const cp = connPlayersRef.current.find(p => p.conn === conn);
          if (cp) handleClientAction(cp.id, data.action);
        }
      });

      conn.on('close', () => {
        connPlayersRef.current = connPlayersRef.current.filter(p => p.conn !== conn);
        updateLobbyList();
      });
    });

    peer.on('error', (err: any) => {
      setLoading(false);
      if (err.type === 'unavailable-id') {
        setError('Código já em uso. Tente novamente.');
      } else {
        setError(`Erro: ${err.message || err}`);
      }
    });
  }, [playerName, updateLobbyList, handleClientAction]);

  // ═══════════════════════════════════════
  // HOST: Start / New Round
  // ═══════════════════════════════════════
  const startRound = useCallback(() => {
    const players = connPlayersRef.current.map(p => ({ id: p.id, name: p.name }));
    if (players.length < 1) return;
    hostStateRef.current = initHostState(players);
    setScreen('game');
    broadcastState();
    if (hostStateRef.current.status === 'finished') {
      updateScores();
    }
  }, [broadcastState, updateScores]);

  // ═══════════════════════════════════════
  // HOST: Own action (hit/stand)
  // ═══════════════════════════════════════
  const hostAction = useCallback((action: 'hit' | 'stand') => {
    if (!hostStateRef.current || hostStateRef.current.status !== 'playing') return;
    if (hostStateRef.current.currentPlayerIndex !== 0) return;
    if (action === 'hit') {
      hostStateRef.current = doHit(hostStateRef.current, 0);
    } else {
      hostStateRef.current = doStand(hostStateRef.current, 0);
    }
    broadcastState();
    if (hostStateRef.current.status === 'finished') {
      updateScores();
    }
  }, [broadcastState, updateScores]);

  // ═══════════════════════════════════════
  // CLIENT: Join Room
  // ═══════════════════════════════════════
  const joinRoom = useCallback(() => {
    if (!playerName.trim()) { setError('Digite seu nome!'); return; }
    if (!joinCode.trim()) { setError('Digite o código da sala!'); return; }
    setLoading(true);
    setError('');

    const code = joinCode.trim().toUpperCase();
    setRoomCode(code);
    roomCodeRef.current = code;

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (myId: string) => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      hostConnRef.current = conn;

      conn.on('open', () => {
        setLoading(false);
        setIsHost(false);
        setScreen('lobby');
        conn.send({ type: 'join', name: playerName.trim(), id: myId });
      });

      conn.on('data', (data: any) => {
        if (data.type === 'state') {
          setGameState(data.state);
          setMyIndex(data.yourIndex);
          setScreen('game');
        }
        if (data.type === 'lobby') {
          setLobbyPlayers(data.players);
        }
      });

      conn.on('close', () => {
        setError('Conexão com o host perdida!');
        cleanup();
        setScreen('home');
      });

      conn.on('error', () => {
        setError('Erro na conexão.');
      });
    });

    peer.on('error', (err: any) => {
      setLoading(false);
      if (err.type === 'peer-unavailable') {
        setError('Sala não encontrada! Verifique o código.');
      } else {
        setError(`Erro: ${err.message || err}`);
      }
    });
  }, [playerName, joinCode, cleanup]);

  // ═══════════════════════════════════════
  // CLIENT: Send action to host
  // ═══════════════════════════════════════
  const clientAction = useCallback((action: 'hit' | 'stand') => {
    if (hostConnRef.current) {
      try { hostConnRef.current.send({ type: 'action', action }); } catch (_e) { /* ignore */ }
    }
  }, []);

  // ═══════════════════════════════════════
  // Go back to home
  // ═══════════════════════════════════════
  const goHome = useCallback(() => {
    cleanup();
    setScreen('home');
    setGameState(null);
    setMyIndex(-1);
    setLobbyPlayers([]);
    setError('');
    setRoomCode('');
    setJoinCode('');
  }, [cleanup]);

  // ═══════════════════════════════════════════════════════════
  // RENDER: HOME SCREEN
  // ═══════════════════════════════════════════════════════════
  if (screen === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-900 via-green-800 to-green-950 flex items-center justify-center p-4">
        <div className="bg-green-800/80 backdrop-blur rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-green-600/40">
          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-black text-white mb-1 tracking-tight">
              <span className="text-red-400">♥</span> Blackjack <span className="text-white">♠</span>
            </h1>
            <p className="text-green-300 text-sm">Multiplayer Online — Peer to Peer</p>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-400/50 text-red-200 p-3 rounded-lg mb-5 text-sm text-center">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="text-green-200 text-sm font-medium block mb-1.5">Seu nome</label>
              <input
                type="text"
                value={playerName}
                onChange={e => { setPlayerName(e.target.value); setError(''); }}
                className="w-full px-4 py-3 bg-green-950/80 border border-green-500/40 rounded-xl text-white placeholder-green-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/60 focus:border-yellow-500/60 transition"
                placeholder="Ex: João"
                maxLength={20}
              />
            </div>

            {/* Create */}
            <button
              onClick={createRoom}
              disabled={loading}
              className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-400 text-green-900 font-bold rounded-xl transition disabled:opacity-50 text-lg shadow-lg shadow-yellow-500/20 active:scale-[0.98]"
            >
              {loading ? '⏳ Criando...' : '🃏 Criar Mesa'}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <hr className="flex-1 border-green-600/50" />
              <span className="text-green-500 text-xs uppercase tracking-wider">ou entre numa mesa</span>
              <hr className="flex-1 border-green-600/50" />
            </div>

            {/* Join */}
            <div>
              <label className="text-green-200 text-sm font-medium block mb-1.5">Código da mesa</label>
              <input
                type="text"
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value.toUpperCase()); setError(''); }}
                className="w-full px-4 py-3 bg-green-950/80 border border-green-500/40 rounded-xl text-white placeholder-green-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/60 focus:border-yellow-500/60 transition uppercase tracking-[0.4em] text-center text-2xl font-mono"
                placeholder="XXXX"
                maxLength={4}
              />
            </div>

            <button
              onClick={joinRoom}
              disabled={loading}
              className="w-full py-3.5 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition disabled:opacity-50 text-lg shadow-lg shadow-green-600/20 active:scale-[0.98]"
            >
              {loading ? '⏳ Conectando...' : '🎰 Entrar na Mesa'}
            </button>
          </div>

          {/* Footer */}
          <div className="mt-8 text-center space-y-1">
            <p className="text-green-500/70 text-[11px]">
              Conexão direta peer-to-peer via WebRTC
            </p>
            <p className="text-green-500/70 text-[11px]">
              Sem servidor — seus dados ficam entre vocês
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: LOBBY
  // ═══════════════════════════════════════════════════════════
  if (screen === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-900 via-green-800 to-green-950 flex items-center justify-center p-4">
        <div className="bg-green-800/80 backdrop-blur rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-green-600/40">
          <button onClick={goHome} className="text-green-400 hover:text-white text-sm mb-5 flex items-center gap-1 transition">
            ← Voltar
          </button>

          <h2 className="text-2xl font-bold text-white text-center mb-6">🃏 Mesa de Blackjack</h2>

          {/* Room code */}
          <div className="bg-green-950/80 rounded-xl p-5 sm:p-6 mb-6 text-center border border-green-600/20">
            <p className="text-green-400 text-xs uppercase tracking-wider mb-2">Código da mesa</p>
            <p className="text-4xl sm:text-5xl font-mono font-black text-yellow-400 tracking-[0.3em] select-all">
              {roomCode}
            </p>
            <p className="text-green-500 text-xs mt-3">
              Envie este código para seus amigos entrarem!
            </p>
          </div>

          {/* Players list */}
          <div className="mb-6">
            <h3 className="text-green-300 font-medium mb-3 text-sm">
              Jogadores na mesa ({lobbyPlayers.length}):
            </h3>
            <ul className="space-y-2">
              {lobbyPlayers.map((name, i) => (
                <li key={i} className="flex items-center gap-3 bg-green-950/50 px-4 py-3 rounded-xl border border-green-700/30">
                  <span className="text-xl">{i === 0 ? '👑' : '🎮'}</span>
                  <span className="text-white font-medium flex-1">{name}</span>
                  {i === 0 && (
                    <span className="text-yellow-400 text-[10px] bg-yellow-400/10 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
                      host
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Start button or waiting */}
          {isHost ? (
            <button
              onClick={startRound}
              className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-400 text-green-900 font-bold rounded-xl transition text-lg shadow-lg shadow-yellow-500/20 active:scale-[0.98]"
            >
              ⚡ Iniciar Jogo
            </button>
          ) : (
            <div className="text-center py-3">
              <p className="text-green-300 animate-pulse">
                ⏳ Aguardando o host iniciar o jogo...
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: GAME
  // ═══════════════════════════════════════════════════════════
  if (!gameState) {
    return (
      <div className="min-h-screen bg-green-900 flex items-center justify-center">
        <p className="text-green-300 animate-pulse text-lg">Carregando...</p>
      </div>
    );
  }

  const isMyTurn = gameState.status === 'playing' && gameState.currentPlayerIndex === myIndex;
  const showActions = gameState.status === 'playing' && isMyTurn;
  const showNewRound = gameState.status === 'finished' && isHost;
  const showWaiting = gameState.status === 'finished' && !isHost;
  const dealerBust = gameState.status === 'finished' && gameState.dealerScore > 21;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 via-green-800 to-green-950 p-2 sm:p-4 pb-28">
      <div className="max-w-2xl mx-auto">

        {/* Top bar */}
        <div className="flex justify-between items-center mb-3 px-1">
          <button onClick={goHome} className="text-green-500 hover:text-white text-xs transition">
            ← Sair
          </button>
          <div className="flex items-center gap-2">
            <span className="text-green-500 text-xs">Mesa:</span>
            <span className="font-mono font-bold text-yellow-400 text-sm tracking-wider">{roomCode}</span>
          </div>
        </div>

        {/* Status message */}
        <div className="text-center mb-4">
          <span className={`inline-block px-5 py-1.5 rounded-full text-sm font-bold transition-colors ${
            gameState.status === 'finished'
              ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
              : gameState.status === 'playing' && isMyTurn
              ? 'bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse'
              : 'bg-green-700/40 text-green-200 border border-green-600/30'
          }`}>
            {gameState.status === 'playing' && isMyTurn ? '🎯 SUA VEZ!' : gameState.message}
          </span>
        </div>

        {/* ═══ DEALER ═══ */}
        <div className="bg-green-800/50 rounded-xl p-3 sm:p-4 mb-3 border border-green-600/30">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-green-300 font-bold text-sm flex items-center gap-1.5">
              🎩 DEALER
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-white font-mono font-bold text-lg">{gameState.dealerScore}</span>
              {dealerBust && (
                <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                  Estourou!
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 sm:gap-2 flex-wrap">
            {gameState.dealerCards.map((card, i) => (
              <CardView key={`d-${i}`} card={card} />
            ))}
          </div>
        </div>

        {/* ═══ PLAYERS ═══ */}
        <div className="space-y-2.5">
          {gameState.players.map((player, i) => {
            const isCurrent = gameState.status === 'playing' && i === gameState.currentPlayerIndex;
            const isMe = i === myIndex;
            const result = gameState.results[player.id];

            return (
              <div
                key={player.id}
                className={`rounded-xl p-3 sm:p-4 border-2 transition-all ${
                  isCurrent
                    ? 'bg-yellow-500/10 border-yellow-400/60 shadow-lg shadow-yellow-500/10'
                    : isMe
                    ? 'bg-green-700/20 border-green-400/40'
                    : 'bg-green-800/20 border-green-700/20'
                }`}
              >
                {/* Player header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-base flex-shrink-0">{isMe ? '👤' : '🎮'}</span>
                    <span className={`font-bold text-sm truncate ${isMe ? 'text-yellow-300' : 'text-green-200'}`}>
                      {player.name}
                      {isMe ? ' (você)' : ''}
                    </span>
                    {isCurrent && (
                      <span className="bg-yellow-500 text-green-900 text-[9px] px-2 py-0.5 rounded-full font-black animate-pulse flex-shrink-0 uppercase">
                        Jogando
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-white font-mono font-bold text-lg">{player.score}</span>
                    {player.status === 'bust' && (
                      <span className="bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full font-bold uppercase">
                        Estourou
                      </span>
                    )}
                    {player.status === 'blackjack' && (
                      <span className="bg-yellow-500 text-green-900 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase">
                        Blackjack!
                      </span>
                    )}
                    {player.status === 'stand' && gameState.status === 'playing' && (
                      <span className="bg-blue-500 text-white text-[9px] px-2 py-0.5 rounded-full font-bold uppercase">
                        Parou
                      </span>
                    )}
                    {result && (
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                        result === 'win' || result === 'blackjack'
                          ? 'bg-emerald-500 text-white'
                          : result === 'lose'
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-500 text-white'
                      }`}>
                        {result === 'win' ? '✓ Ganhou!' :
                         result === 'blackjack' ? '★ BJ!' :
                         result === 'lose' ? '✗ Perdeu' :
                         '= Empate'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Player cards */}
                <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                  {player.cards.map((card, j) => (
                    <CardView key={`p${i}-c${j}`} card={card} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ═══ SCOREBOARD ═══ */}
        {Object.keys(scores).length > 0 && (
          <div className="mt-4 bg-green-800/30 rounded-xl p-3 sm:p-4 border border-green-700/30">
            <h4 className="text-green-400 text-xs font-bold mb-2 uppercase tracking-wider">Placar Geral</h4>
            <div className="space-y-1">
              {Object.entries(scores).map(([name, [w, l, p]]) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="text-green-200 truncate mr-2">{name}</span>
                  <div className="flex gap-3 text-xs font-mono flex-shrink-0">
                    <span className="text-emerald-400">{w}V</span>
                    <span className="text-red-400">{l}D</span>
                    <span className="text-gray-400">{p}E</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ BOTTOM ACTION BAR ═══ */}
      {showActions && (
        <div className="fixed bottom-0 left-0 right-0 bg-green-950/95 backdrop-blur border-t-2 border-yellow-500/40 p-3 sm:p-4 z-50">
          <div className="max-w-2xl mx-auto flex gap-3">
            <button
              onClick={() => isHost ? hostAction('hit') : clientAction('hit')}
              className="flex-1 py-4 bg-red-500 hover:bg-red-400 active:bg-red-600 text-white font-bold rounded-xl text-lg transition active:scale-[0.97] shadow-lg shadow-red-500/30"
            >
              🃏 PEDIR
            </button>
            <button
              onClick={() => isHost ? hostAction('stand') : clientAction('stand')}
              className="flex-1 py-4 bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white font-bold rounded-xl text-lg transition active:scale-[0.97] shadow-lg shadow-blue-500/30"
            >
              ✋ PARAR
            </button>
          </div>
        </div>
      )}

      {showNewRound && (
        <div className="fixed bottom-0 left-0 right-0 bg-green-950/95 backdrop-blur border-t-2 border-yellow-500/40 p-3 sm:p-4 z-50">
          <div className="max-w-2xl mx-auto flex gap-3">
            <button
              onClick={goHome}
              className="py-4 px-6 bg-green-700 hover:bg-green-600 text-white font-bold rounded-xl transition active:scale-[0.97]"
            >
              🚪
            </button>
            <button
              onClick={startRound}
              className="flex-1 py-4 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-green-900 font-bold rounded-xl text-lg transition active:scale-[0.97] shadow-lg shadow-yellow-500/30"
            >
              🔄 Nova Rodada
            </button>
          </div>
        </div>
      )}

      {showWaiting && (
        <div className="fixed bottom-0 left-0 right-0 bg-green-950/95 backdrop-blur border-t-2 border-green-700/50 p-4 z-50">
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-green-400 animate-pulse text-sm">
              ⏳ Aguardando o host iniciar nova rodada...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
