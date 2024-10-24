import ConfettiExplosion from 'react-confetti-explosion';
import { cardBackImageURL, cardImageURL } from '../lib/cards';

export default function Game() {
  return (
    <div className="flex flex-col h-full w-full items-end">
      <ConfettiExplosion
        force={0.8}
        duration={4000}
        particleCount={400}
        width={window.innerWidth}
        height={window.innerHeight}
      />
      <OpponentHand position="top" />
      <div className="flex flex-row w-full">
        <OpponentHand position="left" />
        <Board />
        <OpponentHand position="right" />
      </div>
      <MyHand />
    </div>
  );
}

function Board() {
  return (
    <div className="flex flex-row items-center w-full gap-0 mt-40 justify-center">
      <img className="w-12" src={cardBackImageURL()} />
      <img className="w-12" src={cardBackImageURL()} />
      <img className="w-12" src={cardBackImageURL()} />
      <img className="w-12" src={cardBackImageURL()} />
      <img className="w-12" src={cardBackImageURL()} />
    </div>
  );
}

function MyHand() {
  return (
    <div className="flex flex-col items-center w-full gap-0 mt-40">
      <Chips />
      <div className="flex flex-row justify-center items-center w-full">
        <img className="w-36" src={cardImageURL({ suit: 'H', rank: '6' })} />
        <img className="w-36" src={cardImageURL({ suit: 'C', rank: 'K' })} />
      </div>
      <input
        type="number"
        step="1"
        min="1"
        max="100"
        className="border border-gray-300 rounded-lg p-3 text-center w-1/3 shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ease-in-out"
        placeholder="Place your bet"
      />
      <button className="bg-blue-500 text-white px-4 py-2 rounded-lg shadow-md mt-4">
        Bet
      </button>
    </div>
  );
}

function OpponentHand({ position }: { position: 'left' | 'right' | 'top' }) {
  const positionClass =
    position === 'left'
      ? 'justify-start'
      : position === 'right'
      ? 'justify-end'
      : 'justify-center';

  return (
    <div className="flex flex-col items-center w-full gap-0">
      <div className={`flex flex-row items-center w-full ${positionClass}`}>
        {position === 'right' && <Chips />}
        <img className="w-12" src={cardBackImageURL()} />
        <img className="w-12" src={cardBackImageURL()} />
        {position === 'left' && <Chips />}
      </div>
      {position === 'top' && <Chips />}
    </div>
  );
}

const Chips = () => {
  return (
    <img
      className="w-12"
      src={
        'https://i.pinimg.com/originals/64/36/44/643644be80473b0570920700e80fd36f.png'
      }
    />
  );
};
