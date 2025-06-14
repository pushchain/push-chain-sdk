import React from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { UniversalAccount } from '../../types';
import { Button, PushLogo, PushMonotone } from '../common';
import { centerMaskString, getChainId } from '../../helpers';
import { CHAIN_LOGO } from '../../constants';
import { CHAIN } from '@pushchain/core/src/lib/constants/enums';

type TogglePushWalletButtonProps = {
  uid?: string;
  universalAccount: UniversalAccount;
};
const TogglePushWalletButton: React.FC<TogglePushWalletButtonProps> = ({
  uid,
  universalAccount,
}) => {
  const { setMinimiseWallet, isWalletMinimised } = usePushWalletContext(uid);
  const { chain, address } = universalAccount;

  function getChainIcon(chain: CHAIN) {
    const chainId = getChainId(chain);
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
        {getChainIcon(chain)}
        {maskedAddress}
        <PushLogo />
      </Button>
    </>
  );
};

export { TogglePushWalletButton };
