import React from 'react';
import { CHAIN } from '@pushchain/core/src/lib/constants/enums';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { UniversalAccount } from '../../types';
import { Button, PushMonotone } from '../common';
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
  className = 'default',
  style,
}) => {
  const { setMinimiseWallet, isWalletMinimised, toggleButtonRefs , setActiveTriggerId } =
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

  const handleClick = () => {
    setActiveTriggerId(className);
    setMinimiseWallet(!isWalletMinimised);
  };

  const setTriggerRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        toggleButtonRefs.current[className] = node;
      } else {
        delete toggleButtonRefs.current[className];
      }
    },
    [className]
  );

  return (
    <ButtonContainer
      onClick={handleClick}
      ref={setTriggerRef}
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
