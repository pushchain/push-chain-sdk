import React from 'react';
import { useGlobalContext } from '../context/GlobalContext';
import { Box } from 'shared-components';
import { ConnectPushWalletButton } from '@pushprotocol/pushchain-ui-kit';

const Navbar = () => {
  const { pushNetwork, mockTx } = useGlobalContext();

  return (
    <Box display="flex">
      <Box display="flex" flexDirection="column" alignItems="end">
        {pushNetwork && mockTx && (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            width="-webkit-fill-available"
          >
            <ConnectPushWalletButton />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export { Navbar };
