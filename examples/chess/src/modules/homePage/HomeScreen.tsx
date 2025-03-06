import { GAME_STATUS, GameSessionData, PIECE_COLOR } from '@/common';
import { ChessBoard } from '@/components/ChessBoard';
import { useAppContext } from '@/context/AppContext';
import { createNewSession } from '@/services/createNewSession';
import { getRecentSession } from '@/services/getRecentSession';
import { joinExistingSession } from '@/services/joinExistingSession';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, css, Text } from 'shared-components';

const HomeScreen = () => {
  const [showLoader, setShowLoader] = useState(false);

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
    }
    if (pushChain && universalAddress) {
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

  const handleClick = async () => {
    if (showLoader) return;
    if (pushChain) {
      setShowLoader(true);
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
      } finally {
        setShowLoader(false);
      }
    }
  };

  const handleBotClick = () => {
    navigate('/bot');
  };

  return (
    <Box
      display="flex"
      margin="spacing-xl spacing-none spacing-none spacing-none"
      alignItems={{ initial: 'flex-start', lp: 'center' }}
      justifyContent="center"
      gap="spacing-xl"
      flexDirection={{ initial: 'unset', lp: 'column-reverse' }}
    >
      <ChessBoard position="8/8/8/8/8/8/8/8 w - - 0 1" />
      <Box
        display="flex"
        flexDirection="column"
        padding={{
          initial: 'spacing-xxl spacing-none',
          tb: 'spacing-none spacing-md',
        }}
        gap="spacing-lg"
        width={{ initial: '260px', lp: '100%', tb: '100%' }}
        maxWidth={{ initial: 'unset', lp: '390px', tb: '390px' }}
        css={css`
          box-sizing: border-box;
        `}
      >
        <Box display="flex" flexDirection="column" gap="spacing-xxxs">
          <Text color="text-primary-inverse" variant="h2-bold">
            Uni Chess
          </Text>
          <Text color="text-primary-inverse" variant="bm-semibold">
            Play Universal Chess with players from any chain and create on-chain
            history.
          </Text>
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing-sm">
          <Button onClick={handleBotClick}>Play With Bot</Button>
          <Button onClick={handleClick} loading={showLoader}>
            {!showLoader && 'Play Multiplayer'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default HomeScreen;
