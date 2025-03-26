import { Box } from 'shared-components';
import { PushUniversalWallet, usePushWalletContext } from '../../../../../../packages/ui-kit';

const SimulateHeader = () => {
  const { universalAddress } = usePushWalletContext();

  return (
    <Box display="flex" justifyContent="end" width="100%">
      <PushUniversalWallet universalAddress={universalAddress} />
    </Box>
  );
};

export { SimulateHeader };
