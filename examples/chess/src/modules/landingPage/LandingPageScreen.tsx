import { Box } from 'shared-components';
import { PushWalletButton } from '@pushprotocol/pushchain-ui-kit';

const LandingPageScreen = () => {
  return (
    <Box
      display="flex"
      flexDirection="row"
      justifyContent="center"
      width="100%"
      alignItems="center"
      margin="spacing-xl spacing-none"
    >
      <PushWalletButton
        universalAddress={null}
        title="Connect Push Wallet"
        styling={{
          width: '200px',
        }}
      />
    </Box>
  );
};

export { LandingPageScreen };
