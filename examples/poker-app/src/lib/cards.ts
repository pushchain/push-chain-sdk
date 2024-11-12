import BN from 'bn.js';

export const deckOfCards = () => {
  const suits = ['S', 'H', 'D', 'C'];
  const ranks = [
    'A',
    'K',
    'Q',
    'J',
    '10',
    '9',
    '8',
    '7',
    '6',
    '5',
    '4',
    '3',
    '2',
  ];

  const cards = new Set<string>();

  suits.forEach((suit) => {
    ranks.forEach((rank) => {
      cards.add(rank + suit);
    });
  });
  return cards;
};

export const cardImageURL = ({
  suit,
  rank,
}: {
  suit: 'S' | 'H' | 'D' | 'C';
  rank:
    | 'A'
    | 'K'
    | 'Q'
    | 'J'
    | '10'
    | '9'
    | '8'
    | '7'
    | '6'
    | '5'
    | '4'
    | '3'
    | '2';
}) => {
  return `https://deckofcardsapi.com/static/img/${rank}${suit}.svg`;
};

export const cardBackImageURL = () => {
  return 'https://images.squarespace-cdn.com/content/v1/56ba85d9cf80a17a6f304b72/17021f49-d2e2-449f-a7c4-5d0ce8e08b7b/Card-Back.jpg';
};

export const shuffleCards = <T extends string | BN>(cards: Set<T>): Set<T> => {
  const shuffledCards = new Set<T>();
  const cardsArray = Array.from(cards); // Convert to an array once for efficiency

  while (cardsArray.length > 0) {
    const randomIndex = Math.floor(Math.random() * cardsArray.length);
    const randomCard = cardsArray.splice(randomIndex, 1)[0]; // Remove and retrieve the selected card
    shuffledCards.add(randomCard);
  }

  return shuffledCards;
};
