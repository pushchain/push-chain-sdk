import React, { FC } from 'react';
import styled from 'styled-components';
import { usePushWalletContext } from "../../hooks/usePushWallet";
import { CrossIcon, Spinner } from "../../components/common";
import { CONSTANTS, WALLET_CONFIG_URL } from '../../constants';
import { UniversalAddress } from '../../types';

type PushWalletIframeProps = {
    iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
    isWalletVisible: boolean;
    themeMode?: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
    isIframeLoading: boolean;
    setIframeLoading: (isIframeLoading: boolean) => void;
    sendWalletConfig: () => void;
}


const PushWalletIFrame: FC<PushWalletIframeProps> = ({
    iframeRef,
    isWalletVisible,
    isIframeLoading,
    themeMode,
    setIframeLoading,
    sendWalletConfig
}) => {
    const {
        config,
        universalAddress,
        isWalletMinimised,
        setMinimiseWallet,
        handleUserLogOutEvent
    } = usePushWalletContext();


    return (
        <>
            {isWalletVisible ? (
                <FrameContainer
                    isWalletMinimised={isWalletMinimised}
                    universalAddress={universalAddress}
                    themeMode={themeMode ? themeMode : CONSTANTS.THEME.DARK}
                >
                    {isIframeLoading && (
                        <FrameLoadingContainer themeMode={themeMode ? themeMode : CONSTANTS.THEME.DARK}>
                            <CloseButtonContainer
                                onClick={() => {
                                    handleUserLogOutEvent();
                                }}
                            >
                                <CrossIcon height='20px' width='20px' color={themeMode === CONSTANTS.THEME.LIGHT ? '#000' : '#FFF'} />
                            </CloseButtonContainer>
                            <LoadingTextContainer>
                                <LoadingText>Loading...</LoadingText>
                                <Spinner />
                            </LoadingTextContainer>
                        </FrameLoadingContainer>
                    )}

                    <FrameSubContainer
                        isWalletMinimised={isWalletMinimised}
                        isIframeLoading={isIframeLoading}
                    >
                        <AccountContainer universalAddress={universalAddress}>
                            {universalAddress ? (
                                <DashButtonContainer onClick={() => setMinimiseWallet(true)}>
                                    <CrossIcon height='18px' width='18px' color={themeMode === CONSTANTS.THEME.LIGHT ? '#FFF' : '#000'} />
                                </DashButtonContainer>
                            ) : (
                                <CloseButtonContainer
                                    onClick={() => {
                                        handleUserLogOutEvent();
                                    }}
                                >
                                    <CrossIcon height='20px' width='20px' color={themeMode === CONSTANTS.THEME.LIGHT ? '#000' : '#FFF'} />
                                </CloseButtonContainer>
                            )}
                        </AccountContainer>

                        <iframe
                            src={`${WALLET_CONFIG_URL[config.env]}/auth?app=${window.location.origin}`}
                            allow="publickey-credentials-create; publickey-credentials-get; *"
                            ref={iframeRef}
                            style={{
                                border: 'none',
                                width: '-webkit-fill-available',
                                height: '100vh',
                                borderRadius: universalAddress ? '10px' : '0px'
                            }}
                            onLoad={() => {
                                setIframeLoading(false)
                                sendWalletConfig();
                            }}
                        />



                    </FrameSubContainer>
                </FrameContainer>
            ) : null}
        </>
    );
};

export { PushWalletIFrame };

const FrameContainer = styled.div<{
    universalAddress: UniversalAddress | null;
    isWalletMinimised: boolean;
    themeMode: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
}>`
  position: ${({ universalAddress }) => universalAddress ? 'absolute' : 'fixed'};
  display: flex;
  flex-direction: column;
  background-color: ${({ themeMode }) => themeMode === CONSTANTS.THEME.LIGHT ? '#F5F6F8' : '#17181b'};
  border-radius: 10px;
  z-index: 9999;

  width: ${({ universalAddress, isWalletMinimised }) =>
        isWalletMinimised ? '0px' : universalAddress ? '450px' : '100vw'};
  height: ${({ universalAddress, isWalletMinimised }) =>
        isWalletMinimised ? '0px' : universalAddress ? '675px' : '100vh'};
  right: ${({ universalAddress }) => (universalAddress ? '0px' : '0')};
  top: ${({ universalAddress }) => (universalAddress ? '50px' : '0')};

  @media (max-width: 425px) {
    width: ${({ universalAddress, isWalletMinimised }) =>
        isWalletMinimised ? '0px' : universalAddress ? '96%' : '100%'};
    right: ${({ universalAddress }) => (universalAddress ? '2%' : '0')};
    top: ${({ universalAddress }) => (universalAddress ? '8%' : '0')};
  }
`;

const CloseButtonContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  cursor: pointer;
  padding: 0 16px;
`;

const DashButtonContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 1000px;
  height: 20px;
  width: 20px;
  padding:2px;
  background-color: #ff0000;
`;

const LoadingTextContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: -webkit-fill-available;
  height: -webkit-fill-available;
`;

const LoadingText = styled.p`
  font-size: 18px;
  font-weight: 500;
  line-height: 27px;
  color: inherit;
  font-family: FK Grotesk Neu;
  margin: 0px;
  width: auto;
`;

const FrameLoadingContainer = styled.div<{
    themeMode: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
}>`
  height: -webkit-fill-available;
  width: -webkit-fill-available;
  flex-direction: column;
  display: flex;
  padding: 8px;
  color:${({ themeMode }) => themeMode === CONSTANTS.THEME.LIGHT ? '#17181b' : '#F5F6F8'};
 background-color: ${({ themeMode }) => themeMode === CONSTANTS.THEME.LIGHT ? '#F5F6F8' : '#17181b'};
`;

const FrameSubContainer = styled.div<{
    isWalletMinimised: boolean;
    isIframeLoading: boolean;
}>`
    display: ${({ isWalletMinimised, isIframeLoading }) =>
        isWalletMinimised || isIframeLoading ? 'none' : 'flex'};
    width: -webkit-fill-available;
    height: -webkit-fill-available;
    flex-direction: column;
  `;

const AccountContainer = styled.div<{ universalAddress: UniversalAddress | null }>`
  width: -webkit-fill-available;
  display: flex;
  align-items: center;
  position:absolute;
  top:4px;
  right:4px;
  justify-content: flex-end;
  padding: var(--spacing-xxs) var(--spacing-xxs);
  border-top-right-radius: ${({ universalAddress }) => (universalAddress ? '10px' : '0px')};
  border-top-left-radius: ${({ universalAddress }) => (universalAddress ? '10px' : '0px')};
  background-color: transparent;
`;
