import React from 'react';
import { CHAIN } from '@pushchain/core/src/lib/constants/enums';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { UniversalAccount } from '../../types';
import { Button, PushLogo, PushMonotone } from '../common';
import { centerMaskString, getChainId } from '../../helpers';
import { CHAIN_LOGO } from '../../constants';
import styled from 'styled-components';

export type TogglePushWalletButtonProps = {
  uid?: string;
  universalAccount: UniversalAccount;
  style?: React.CSSProperties;
  customComponent?: React.ReactNode;
  className?: string;
};
const TogglePushWalletButton: React.FC<TogglePushWalletButtonProps> = ({
  uid,
  universalAccount,
  customComponent,
  className,
  style,
}) => {
  const { setMinimiseWallet, isWalletMinimised, toggleButtonRef } =
    usePushWalletContext(uid);
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
    <ButtonContainer
      onClick={() => setMinimiseWallet(!isWalletMinimised)}
      ref={toggleButtonRef}
    >
      {customComponent ? customComponent : (
        <Button
          bgColor="var(--pwauth-btn-connected-bg-color)"
          textColor="var(--pwauth-btn-connected-text-color)"
          borderRadius="var(--pwauth-btn-connect-border-radius)"
          gap='8px'
          padding='12px'
          style={style}
          className={className}
        >
          {getChainIcon(chain)}
          {maskedAddress}
        </Button>
      )}
    </ButtonContainer>
  );
};

export { TogglePushWalletButton };

const ButtonContainer = styled.div`
  cursor: pointer;
`;
