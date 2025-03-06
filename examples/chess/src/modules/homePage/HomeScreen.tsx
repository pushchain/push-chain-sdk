import { ChessBoard } from '@/components/ChessBoard';
import { useAppContext } from '@/context/AppContext';
import { useChess } from '@/hooks/useChess';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, css, Text } from 'shared-components';

const HomeScreen = () => {
  const [showLoader, setShowLoader] = useState(false);

  const { pushChain } = useAppContext();
  const { startMultiplayer } = useChess();
  const navigate = useNavigate();

  const handleClick = async () => {
    if (!pushChain) return;
    setShowLoader(true);
    try {
      await startMultiplayer();
      navigate('/chess');
    } catch (err) {
      console.log(err);
    } finally {
      setShowLoader(false);
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
