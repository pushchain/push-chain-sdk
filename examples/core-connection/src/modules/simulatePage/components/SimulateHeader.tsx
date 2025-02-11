import { Box } from 'shared-components';
import {
  PushWalletButton,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';

const SimulateHeader = () => {
  const { universalAddress } = usePushWalletContext();

  return (
    <Box display="flex" justifyContent="end" width="100%">
      <PushWalletButton universalAddress={universalAddress} />
    </Box>
  );
};

export { SimulateHeader };
