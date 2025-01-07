import React from 'react';
import { Box, Button, PushLogo, PushMonotone } from 'shared-components';
import { centerMaskString, getWalletDataFromAccount } from '../wallet.utils';
import { CHAIN_LOGO } from '../../constants';
import { usePushWalletContext } from './PushWalletProvider';

type TogglePushWalletButtonProps = {
  account: string;
};
const TogglePushWalletButton: React.FC<TogglePushWalletButtonProps> = ({
  account,
}) => {
  const { setMinimiseWallet } = usePushWalletContext();
  const { chainId, address } = getWalletDataFromAccount(account);

  function getChainIcon(chainId: string | null) {
    if (!chainId) {
      return <PushMonotone size={20} />;
    }
    const IconComponent = CHAIN_LOGO[chainId];
    if (IconComponent) {
      return <IconComponent size={20} color="icon-tertiary" />;
    } else {
      return <PushMonotone size={20} />;
    }
  }

  const maskedAddress = centerMaskString(address);

  return (
    <Box>
      <Button
        leadingIcon={getChainIcon(chainId)}
        variant="tertiary"
        trailingIcon={<PushLogo width={24} height={24} />}
        onClick={() => setMinimiseWallet(false)}
      >
        {maskedAddress}
      </Button>
    </Box>
  );
};

export { TogglePushWalletButton };
