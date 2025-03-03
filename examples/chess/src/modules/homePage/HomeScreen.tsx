import { GAME_STATUS, GameSessionData, PIECE_COLOR } from '@/common';
import { useAppContext } from '@/context/AppContext';
import { createNewSession } from '@/services/createNewSession';
import { getRecentSession } from '@/services/getRecentSession';
import { joinExistingSession } from '@/services/joinExistingSession';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { useNavigate } from 'react-router-dom';
import { Box, Button } from 'shared-components';

const HomeScreen = () => {
  const { pushChain, setCurrentSession } = useAppContext();
  const { universalAddress } = usePushWalletContext();
  const navigate = useNavigate();

  // const listenGameSession = async () => {
  //   if (pushChain) {
  //     console.log('check1');
  //     await pushChain.ws.connect();
  //     console.log('websocket connected');

  //     await pushChain.ws.subscribe(async (block) => {
  //       for (const tx of block.transactions) {
  //         if (tx.category === 'CHESS_GAME_SESSION') {
  //           console.log(tx);
  //         }
  //       }
  //     }, customSessionFilters);
  //   }
  // };

  // useEffect(() => {
  //   console.log('check');
  //   listenGameSession();
  // }, [pushChain]);

  const handleCreateSession = async () => {
    if (pushChain && universalAddress) {
      const randomColor =
        Math.random() < 0.5 ? PIECE_COLOR.BLACK : PIECE_COLOR.WHITE;
      const data: GameSessionData = {
        gameId: `${Date.now()}`,
        player1: {
          address: universalAddress.address,
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
    if (data.player1.address === universalAddress?.address) {
      setCurrentSession(data);
    }
    if (pushChain && universalAddress) {
      const newPieceColor =
        data.player1.pieceColor === PIECE_COLOR.WHITE
          ? PIECE_COLOR.BLACK
          : PIECE_COLOR.WHITE;
      const newData: GameSessionData = {
        ...data,
        player2: {
          address: universalAddress.address,
          pieceColor: newPieceColor,
        },
        status: GAME_STATUS.CLOSED,
      };
      await joinExistingSession(pushChain, newData);
      setCurrentSession(newData);
    }
  };

  const handleClick = async () => {
    if (pushChain) {
      const data = await getRecentSession(pushChain);
      console.log(data);
      if (!data) {
        await handleCreateSession();
      } else {
        await handleJoinSession(data);
      }
      navigate('/chess');
    }
  };

  const handleBotClick = () => {
    navigate('/bot');
  };

  return (
    <Box display="flex" gap="spacing-xs">
      <Button onClick={handleClick}>Play Online</Button>
      <Button onClick={handleBotClick}>Play With Bot</Button>
    </Box>
  );
};

export default HomeScreen;
