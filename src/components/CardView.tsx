const suitSymbols: Record<string, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

export default function CardView({ card }: { card: string }) {
  if (card === '??') {
    return (
      <div className="w-[52px] h-[76px] sm:w-[60px] sm:h-[88px] bg-gradient-to-br from-blue-600 via-blue-700 to-blue-900 rounded-lg border-2 border-blue-400/60 flex items-center justify-center shadow-md flex-shrink-0 select-none">
        <div className="text-blue-300/80 text-xl sm:text-2xl font-bold">?</div>
      </div>
    );
  }

  const rank = card.slice(0, -1);
  const suitChar = card.slice(-1);
  const symbol = suitSymbols[suitChar] || '';
  const red = suitChar === 'H' || suitChar === 'D';

  return (
    <div
      className={`w-[52px] h-[76px] sm:w-[60px] sm:h-[88px] bg-white rounded-lg border-2 flex flex-col justify-between p-1 sm:p-1.5 shadow-md flex-shrink-0 select-none ${
        red
          ? 'text-red-500 border-red-200'
          : 'text-gray-800 border-gray-200'
      }`}
    >
      <div className="text-[10px] sm:text-xs font-bold leading-none">
        {rank}
        <br />
        {symbol}
      </div>
      <div className="text-xl sm:text-2xl text-center leading-none">{symbol}</div>
      <div className="text-[10px] sm:text-xs font-bold leading-none self-end rotate-180">
        {rank}
        <br />
        {symbol}
      </div>
    </div>
  );
}
