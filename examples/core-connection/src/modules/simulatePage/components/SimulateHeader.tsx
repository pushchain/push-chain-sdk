import { Box } from 'shared-components';
import {
  PushWalletButton,
  usePushWalletContext,
} from '../../../../../../packages/ui-kit';

const SimulateHeader = () => {
  const { universalAddress } = usePushWalletContext();

  return (
    <Box display="flex" justifyContent="end" width="100%">
      <PushWalletButton universalAddress={universalAddress} />
    </Box>
  );
};

export { SimulateHeader };
