import { Box } from 'shared-components';
import { useGlobalContext } from '../../../context/GlobalContext';
import { PushUniversalWallet } from '../../../../../../packages/ui-kit';

const SimulateHeader = () => {
  const { universalAddress } = useGlobalContext();

  return (
    <Box display="flex" justifyContent="end" width="100%">
      <PushUniversalWallet universalAddress={universalAddress} />
    </Box>
  );
};

export { SimulateHeader };
