import { Chessboard, ClearPremoves } from 'react-chessboard';
import { ChessboardProps } from 'react-chessboard/dist/chessboard/types';
import { Box, css } from 'shared-components';

const customPieces = () => {
  const pieceComponents: {
    [key: string]: any;
  } = {};

  [
    'wP',
    'wR',
    'wN',
    'wB',
    'wQ',
    'wK',
    'bP',
    'bR',
    'bN',
    'bB',
    'bQ',
    'bK',
  ].forEach((piece) => {
    pieceComponents[piece] = ({ squareWidth }: { squareWidth: number }) => (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        width={`${squareWidth}px`}
        height={`${squareWidth}px`}
      >
        <img
          src={`/pieces/${piece}.png`}
          alt={piece}
          height={
            squareWidth *
            (piece[1] === 'P' ? 0.7 : ['K', 'Q'].includes(piece[1]) ? 0.9 : 0.8)
          }
          style={{ objectFit: 'contain' }}
        />
      </Box>
    );
  });

  return pieceComponents;
};

const ChessBoard: React.FC<
  Omit<ChessboardProps, 'ref'> & import('react').RefAttributes<ClearPremoves>
> = (props) => {
  return (
    <Box
      width="100%"
      maxWidth="615px"
      padding="spacing-xs"
      css={css`
        background-color: #313134;
        border-radius: 16px;
        box-sizing: border-box;
      `}
    >
      <Chessboard
        customBoardStyle={{
          borderRadius: '12px',
        }}
        customDarkSquareStyle={{ backgroundColor: '#8778B8' }}
        customLightSquareStyle={{ backgroundColor: '#EFEFEF' }}
        customPieces={customPieces()}
        {...props}
      />
    </Box>
  );
};

export { ChessBoard };
