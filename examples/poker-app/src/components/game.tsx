import { cardBackImageURL, cardImageURL } from '../lib/cards';

export default function Game() {
  return (
    <div className="flex flex-col h-full w-full items-end">
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
