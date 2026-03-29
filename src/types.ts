export interface PlayerData {
  id: string;
  name: string;
  cards: string[];
  score: number;
  status: 'waiting' | 'playing' | 'stand' | 'bust' | 'blackjack';
}

export interface PublicGameState {
  roomCode: string;
  status: 'waiting' | 'playing' | 'dealer_turn' | 'finished';
  players: PlayerData[];
  dealerCards: string[];
  dealerScore: number;
  currentPlayerIndex: number;
  results: Record<string, 'win' | 'lose' | 'push' | 'blackjack'>;
  message: string;
}
