import React, { useState } from 'react';
import { centerMaskString, getWalletDataFromAccount } from '../wallet.utils';
import { CHAIN_LOGO } from '../../constants';
import { usePushWalletContext } from './PushWalletProvider';
import { PushLogo, PushMonotone } from '../../common';
import styled from 'styled-components';

type TogglePushWalletButtonProps = {
  account: string;
};
const TogglePushWalletButton: React.FC<TogglePushWalletButtonProps> = ({
  account,
}) => {
  const { setMinimiseWallet, handleLogOut } = usePushWalletContext();
  const { chainId, address } = getWalletDataFromAccount(account);

  const [isDropdownOpen, setDropdownOpen] = useState(false);

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

  // New function to toggle dropdown visibility
  const toggleDropdown = () => {
    setDropdownOpen(!isDropdownOpen);
  };

  const handleLogOutButton = () => {
    handleLogOut();
  };

  return (
    <>
      <DropdownContainer>
        <ButtonComponent onClick={toggleDropdown}>
          {getChainIcon(chainId)}
          {maskedAddress}
          <PushLogo />
        </ButtonComponent>
        {isDropdownOpen && (
          <DropdownMenu>
            <ButtonComponent onClick={handleLogOutButton}>
              Logout
            </ButtonComponent>
          </DropdownMenu>
        )}
      </DropdownContainer>
    </>
  );
};

export { TogglePushWalletButton };

const ButtonComponent = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-family: FK Grotesk Neu;
  white-space: nowrap;
  flex-shrink: 0;
  border: none;
  background-color: #17181b;
  color: rgba(255, 255, 255, 1);
  border-radius: 12px;
  gap: 4px;
  height: 48px;
  width: -webkit-fill-available;
  padding: 16px 24px;
  leading-trim: both;
  text-edge: cap;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 16px;
`;

// New styled components for dropdown
const DropdownContainer = styled.div`
  position: relative;
`;

const DropdownMenu = styled.div`
  position: absolute;
  background-color: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1;
  width: -webkit-fill-available;
  border-radius: 12px;
  background-color: #17181b;
  color: rgba(255, 255, 255, 1);
`;

const DropdownItem = styled.button`
  padding: 8px 16px;
  cursor: pointer;
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  color: rgba(255, 255, 255, 1);
  height: 48px;
`;
