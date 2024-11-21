
import { Clock } from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

interface Player {
  id: number;
  name: string;
  chips: number;
  cards: [string, string] | null;
  isCurrentPlayer?: boolean;
}

interface PlayerSeatProps {
  player: Player;
  index: number;
  totalPlayers: number;
}

const Board: React.FC = () => {
  const [betAmount, setBetAmount] = useState<number>(900);
  const [potSize, setPotSize] = useState<number>(6429);

  const players: Player[] = [
    {
      id: 1,
      name: 'Player 1',
      chips: 5650,
      cards: ['A♥', 'K♥'],
      isCurrentPlayer: true,
    },
    { id: 2, name: 'Player 2', chips: 10176, cards: ['?', '?'] },
    { id: 3, name: 'Player 3', chips: 2850, cards: ['?', '?'] },
    { id: 4, name: 'Player 4', chips: 10884, cards: ['?', '?'] },
    { id: 5, name: 'Player 5', chips: 10176, cards: ['?', '?'] },
    { id: 6, name: 'Player 6', chips: 2850, cards: ['?', '?'] },
    { id: 7, name: 'Player 7', chips: 10884, cards: ['?', '?'] },
    { id: 8, name: 'Player 8', chips: 10176, cards: ['?', '?'] },
  ];

  const communityCards: string[] = ['7♦', 'J♠', '4♣', 'J♥', '3♥'];

  const getPlayerPosition = (
    index: number,
    totalPlayers: number,
    isCurrentPlayer: boolean
  ) => {
    if (isCurrentPlayer) {
      return {
        transform: `translate(-50%, -50%)`,
        left: '50%',
        bottom: '5%',
        top: 'auto',
      };
    }

    // Calculate positions for other players along the top semicircle
    const totalOtherPlayers = totalPlayers - 1;
    const playerIndex = index > 0 ? index - 1 : index;

    // Distribute players across 180 degrees (π radians)
    const angle = (Math.PI / (totalOtherPlayers - 1)) * playerIndex;

    // Calculate position along the semicircle
    const radius = 42; // Percentage of table radius
    const centerX = 50;
    const centerY = 45; // Moved up slightly to give more space at the bottom

    const x = centerX + radius * Math.cos(angle);
    const y = centerY - radius * Math.sin(angle);

    return {
      transform: `translate(-50%, -50%)`,
      left: `${x}%`,
      top: `${y}%`,
    };
  };

  const Card: React.FC<{ card: string; isHidden: boolean }> = ({
    card,
    isHidden,
  }) => (
    <div
      className={`relative w-10 h-14 rounded ${
        isHidden ? 'bg-blue-800' : 'bg-white'
      } flex items-center justify-center ${
        isHidden ? 'text-transparent' : 'text-black'
      } border-2 border-gray-300`}
    >
      {isHidden ? (
        <div className="absolute inset-1 bg-blue-700 rounded pattern-dots pattern-gray-500 pattern-bg-transparent pattern-opacity-20 pattern-size-2" />
      ) : (
        card
      )}
    </div>
  );

  const PlayerSeat: React.FC<PlayerSeatProps> = ({
    player,
    index,
    totalPlayers,
  }) => {
    const positionStyle = getPlayerPosition(
      index,
      totalPlayers,
      player.isCurrentPlayer ?? false
    );

    return (
      <div
        className={`absolute bg-gray-800 rounded-lg p-2 text-white text-sm transition-all duration-500 ease-in-out ${
          player.isCurrentPlayer ? 'border-2 border-yellow-400' : ''
        }`}
        style={positionStyle}
      >
        <div className="font-bold">{player.name}</div>
        <div>{player.chips.toLocaleString()}</div>
        {player.cards && (
          <div className="mt-1 flex gap-1">
            {player.cards.map((card, i) => (
              <Card
                key={i}
                card={card}
                isHidden={!player.isCurrentPlayer && card === '?'}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const getDealerPosition = (index: number, totalPlayers: number) => {
    // Position dealer button slightly to the left of Player 2
    return {
      transform: `translate(-50%, -50%)`,
      left: '25%',
      top: '45%',
    };
  };

  return (
    <div className="w-full h-screen bg-gray-900 p-4">
      <div className="flex justify-between items-center text-white mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <span>Session: 0:56</span>
        </div>
      </div>

      <div className="relative w-full max-w-4xl mx-auto aspect-[4/3] mb-20">
        <div className="absolute inset-0 bg-green-800 rounded-[200px] border-8 border-gray-700">
          {players.map((player, index) => (
            <PlayerSeat
              key={player.id}
              player={player}
              index={index}
              totalPlayers={players.length}
            />
          ))}

          <div
            className="absolute w-6 h-6 bg-white rounded-full text-black text-xs flex items-center justify-center border-2 border-black"
            style={getDealerPosition(0, players.length)}
          >
            D
          </div>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2">
            {communityCards.map((card, i) => (
              <div key={i} className="bg-white rounded px-3 py-2 text-xl">
                {card}
              </div>
            ))}
          </div>

          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 text-white text-xl">
            Pot: {potSize.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-black p-4">
        <div className="max-w-4xl mx-auto flex gap-4 items-center">
          <Button variant="destructive" className="w-24">
            Fold
          </Button>
          <Button variant="default" className="w-24">
            Call
            <br />
            {betAmount}
          </Button>
          <Button variant="default" className="w-24">
            Raise To
            <br />
            {(betAmount * 2).toLocaleString()}
          </Button>
          <div className="flex-1">
            <Slider
              defaultValue={[betAmount]}
              max={10000}
              step={100}
              onValueChange={(value) => setBetAmount(value[0])}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm">Min</Button>
            <Button size="sm">½ Pot</Button>
            <Button size="sm">Pot</Button>
            <Button size="sm">Max</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Board;
