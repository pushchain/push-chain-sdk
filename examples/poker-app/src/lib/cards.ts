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
