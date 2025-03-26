import { Chessboard, ClearPremoves } from 'react-chessboard';
import { ChessboardProps } from 'react-chessboard/dist/chessboard/types';
import { Box, css, Text } from 'shared-components';

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

interface ChessBoardProps {
  waiting?: boolean;
  waitingText?: string;
}

const ChessBoard: React.FC<
  Omit<ChessboardProps, 'ref'> &
    import('react').RefAttributes<ClearPremoves> &
    ChessBoardProps
> = (props) => {
  const { waiting, waitingText, ...chessProps } = props;

  return (
    <Box
      width="100%"
      maxWidth="615px"
      padding="spacing-xs"
      position="relative"
      borderRadius="radius-sm"
      css={css`
        background-color: #313134;
        box-sizing: border-box;
        pointer-events: ${waiting ? 'none' : 'all'};
      `}
    >
      <Box overflow="hidden" borderRadius="radius-xs">
        <Chessboard
          customBoardStyle={{
            borderRadius: '12px',
            filter: waiting ? 'blur(8px)' : 'none',
            opacity: waiting ? '0.5' : '1',
          }}
          customDarkSquareStyle={{ backgroundColor: '#8778B8' }}
          customLightSquareStyle={{ backgroundColor: '#EFEFEF' }}
          customPieces={customPieces()}
          {...chessProps}
        />
      </Box>

      {waiting && (
        <Box
          padding="spacing-xxs spacing-xs"
          borderRadius="radius-xxs"
          position="absolute"
          textAlign="center"
          css={css`
            background-color: #202124;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            white-space: pre-line;
          `}
        >
          <Text
            variant="bs-bold"
            color="text-primary-inverse"
            css={css`
              &::after {
                content: '...';
                animation: dots steps(4, end) 1s infinite;
              }

              @keyframes dots {
                0% {
                  content: '';
                }
                25% {
                  content: '.';
                }
                50% {
                  content: '..';
                }
                75% {
                  content: '...';
                }
                100% {
                  content: '';
                }
              }
            `}
          >
            {waitingText}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export { ChessBoard };
