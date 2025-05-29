import React from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { UniversalAddress } from '../../types';
import { Button, PushLogo, PushMonotone } from '../common';
import { centerMaskString } from '../../helpers';
import { CHAIN_LOGO } from '../../constants';

type TogglePushWalletButtonProps = {
  uid?: string;
  universalAddress: UniversalAddress;
};
const TogglePushWalletButton: React.FC<TogglePushWalletButtonProps> = ({
  uid,
  universalAddress,
}) => {
  const { setMinimiseWallet, isWalletMinimised } = usePushWalletContext(uid);
  const { chainId, address } = universalAddress;

  function getChainIcon(chainId: string | null) {
    if (!chainId) {
      return <PushMonotone />;
    }
    const IconComponent = CHAIN_LOGO[chainId];
    if (IconComponent) {
      return <IconComponent />;
    } else {
      return <PushMonotone />;
    }
  }

  const maskedAddress = centerMaskString(address);

  return (
    <>
      <Button
        onClick={() => setMinimiseWallet(!isWalletMinimised)}
        bgColor="var(--pwauth-btn-connected-bg-color)"
        textColor="var(--pwauth-btn-connected-text-color)"
        borderRadius="var(--pwauth-btn-connect-border-radius)"
      >
        {getChainIcon(chainId)}
        {maskedAddress}
        <PushLogo />
      </Button>
    </>
  );
};

export { TogglePushWalletButton };
