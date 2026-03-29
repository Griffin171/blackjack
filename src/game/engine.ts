import { PlayerData, PublicGameState } from '../types';

const SUITS = ['H', 'D', 'C', 'S'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createShuffledDeck(): string[] {
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function calcScore(cards: string[]): number {
  let score = 0;
  let aces = 0;
  for (const card of cards) {
    if (card === '??') continue;
    const rank = card.slice(0, -1);
    if (rank === 'A') { aces++; score += 11; }
    else if (['K', 'Q', 'J'].includes(rank)) score += 10;
    else score += parseInt(rank);
  }
  while (score > 21 && aces > 0) { score -= 10; aces--; }
  return score;
}

export function genRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// --- Host-only state ---

export interface HostState {
  deck: string[];
  deckIndex: number;
  players: PlayerData[];
  dealerCards: string[];
  currentPlayerIndex: number;
  status: 'waiting' | 'playing' | 'dealer_turn' | 'finished';
  results: Record<string, 'win' | 'lose' | 'push' | 'blackjack'>;
}

export function initHostState(playerNames: { id: string; name: string }[]): HostState {
  const deck = createShuffledDeck();
  let idx = 0;

  const players: PlayerData[] = playerNames.map(p => {
    const cards = [deck[idx++], deck[idx++]];
    const score = calcScore(cards);
    return {
      id: p.id,
      name: p.name,
      cards,
      score,
      status: score === 21 ? 'blackjack' as const : 'playing' as const,
    };
  });

  const dealerCards = [deck[idx++], deck[idx++]];

  let currentPlayerIndex = players.findIndex(p => p.status === 'playing');
  if (currentPlayerIndex === -1) currentPlayerIndex = 0;

  const state: HostState = {
    deck,
    deckIndex: idx,
    players,
    dealerCards,
    currentPlayerIndex,
    status: 'playing',
    results: {},
  };

  // If all players already resolved (blackjack), go to dealer
  if (players.every(p => p.status !== 'playing')) {
    return doDealerTurn(state);
  }

  return state;
}

export function doHit(state: HostState, playerIndex: number): HostState {
  const newState: HostState = {
    ...state,
    players: state.players.map(p => ({ ...p, cards: [...p.cards] })),
    dealerCards: [...state.dealerCards],
  };
  const player = newState.players[playerIndex];

  const card = newState.deck[newState.deckIndex];
  newState.deckIndex++;
  player.cards.push(card);
  player.score = calcScore(player.cards);

  if (player.score > 21) {
    player.status = 'bust';
    return moveToNextPlayer(newState);
  }

  if (player.score === 21) {
    player.status = 'stand';
    return moveToNextPlayer(newState);
  }

  return newState;
}

export function doStand(state: HostState, playerIndex: number): HostState {
  const newState: HostState = {
    ...state,
    players: state.players.map(p => ({ ...p, cards: [...p.cards] })),
    dealerCards: [...state.dealerCards],
  };
  newState.players[playerIndex].status = 'stand';
  return moveToNextPlayer(newState);
}

function moveToNextPlayer(state: HostState): HostState {
  for (let i = state.currentPlayerIndex + 1; i < state.players.length; i++) {
    if (state.players[i].status === 'playing') {
      return { ...state, currentPlayerIndex: i };
    }
  }
  // No more players, dealer's turn
  return doDealerTurn(state);
}

function doDealerTurn(state: HostState): HostState {
  const newState: HostState = {
    ...state,
    status: 'dealer_turn',
    dealerCards: [...state.dealerCards],
  };

  const allBusted = newState.players.every(p => p.status === 'bust');

  if (!allBusted) {
    let dealerScore = calcScore(newState.dealerCards);
    while (dealerScore < 17) {
      newState.dealerCards.push(newState.deck[newState.deckIndex]);
      newState.deckIndex++;
      dealerScore = calcScore(newState.dealerCards);
    }
  }

  const dealerScore = calcScore(newState.dealerCards);
  const dealerBust = dealerScore > 21;
  const dealerBJ = newState.dealerCards.length === 2 && dealerScore === 21;

  const results: Record<string, 'win' | 'lose' | 'push' | 'blackjack'> = {};

  for (const player of newState.players) {
    if (player.status === 'bust') {
      results[player.id] = 'lose';
    } else if (player.status === 'blackjack') {
      results[player.id] = dealerBJ ? 'push' : 'blackjack';
    } else if (dealerBust) {
      results[player.id] = 'win';
    } else if (player.score > dealerScore) {
      results[player.id] = 'win';
    } else if (player.score < dealerScore) {
      results[player.id] = 'lose';
    } else {
      results[player.id] = 'push';
    }
  }

  return { ...newState, status: 'finished', results };
}

export function toPublicState(hostState: HostState, roomCode: string): PublicGameState {
  const reveal = hostState.status === 'dealer_turn' || hostState.status === 'finished';

  return {
    roomCode,
    status: hostState.status,
    players: hostState.players,
    dealerCards: reveal
      ? hostState.dealerCards
      : [hostState.dealerCards[0], '??'],
    dealerScore: reveal
      ? calcScore(hostState.dealerCards)
      : calcScore([hostState.dealerCards[0]]),
    currentPlayerIndex: hostState.currentPlayerIndex,
    results: hostState.results,
    message: getMessage(hostState),
  };
}

function getMessage(state: HostState): string {
  switch (state.status) {
    case 'waiting':
      return 'Aguardando jogadores...';
    case 'playing': {
      const player = state.players[state.currentPlayerIndex];
      return `Vez de ${player.name}`;
    }
    case 'dealer_turn':
      return 'Dealer jogando...';
    case 'finished':
      return 'Rodada finalizada!';
    default:
      return '';
  }
}
