import React, { useEffect } from 'react';
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

  // Apps often render several buttons with the same className (e.g. a header
  // button plus one in an off-canvas mobile drawer). Key each instance
  // separately so a later mount can't overwrite another button's ref.
  const instanceId = React.useId();
  const triggerId = `${className}:${instanceId}`;

  const handleClick = () => {
    setActiveTriggerId(triggerId);
    setMinimiseWallet(!isWalletMinimised);
  };

  const setTriggerRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        toggleButtonRefs.current[triggerId] = node;
      } else {
        delete toggleButtonRefs.current[triggerId];
      }
    },
    [triggerId]
  );

  useEffect(() => {
    setActiveTriggerId(triggerId);
  }, []);

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
