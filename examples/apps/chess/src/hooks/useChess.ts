import { PIECE_COLOR, GameSessionData, GAME_STATUS } from '@/common';
import { useAppContext } from '@/context/AppContext';
import { createNewSession } from '@/services/createNewSession';
import { getRecentSession } from '@/services/getRecentSession';
import { joinExistingSession } from '@/services/joinExistingSession';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { useNavigate } from 'react-router-dom';

const useChess = () => {
  const { pushChain, setCurrentSession } = useAppContext();
  const { universalAddress } = usePushWalletContext();
  const navigate = useNavigate();

  const handleCreateSession = async () => {
    if (pushChain && universalAddress) {
      const randomColor =
        Math.random() < 0.5 ? PIECE_COLOR.BLACK : PIECE_COLOR.WHITE;
      const data: GameSessionData = {
        gameId: `${Date.now()}`,
        player1: {
          universalAddress: universalAddress,
          pieceColor: randomColor,
        },
        player2: null,
        status: GAME_STATUS.WAITING,
        timestamp: Date.now().toString(),
      };
      await createNewSession(pushChain, data);
      setCurrentSession(data);
    }
  };

  const handleJoinSession = async (data: GameSessionData) => {
    if (data.player1.universalAddress.address === universalAddress?.address) {
      setCurrentSession(data);
    } else if (pushChain && universalAddress) {
      const newPieceColor =
        data.player1.pieceColor === PIECE_COLOR.WHITE
          ? PIECE_COLOR.BLACK
          : PIECE_COLOR.WHITE;
      const newData: GameSessionData = {
        ...data,
        player2: {
          universalAddress: universalAddress,
          pieceColor: newPieceColor,
        },
        status: GAME_STATUS.CLOSED,
      };
      await joinExistingSession(pushChain, newData);
      setCurrentSession(newData);
    }
  };

  const startMultiplayer = async () => {
    if (pushChain) {
      try {
        const data = await getRecentSession(pushChain);
        if (!data) {
          await handleCreateSession();
        } else {
          await handleJoinSession(data);
        }
        navigate('/chess');
      } catch (err) {
        console.log(err);
      }
    }
  };

  return { startMultiplayer };
};

export { useChess };
