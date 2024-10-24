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
