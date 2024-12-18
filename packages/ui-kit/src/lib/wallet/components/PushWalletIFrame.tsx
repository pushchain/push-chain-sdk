import React from 'react';
import { usePushWalletContext } from './WalletProvider';
import { Box, Cross, CrossFilled, css, Dash } from 'shared-components';
import config from '../../config';

const PushWalletIFrame = () => {
  const {
    env,
    account,
    iframeRef,
    isWalletMinimised,
    isWalletVisible,
    setMinimiseWallet,
    setWalletVisibility,
  } = usePushWalletContext();

  return (
    <>
      {isWalletVisible ? (
        <Box
          position="fixed"
          width={account ? (isWalletMinimised ? '0px' : '450px') : '100%'}
          height={account ? (isWalletMinimised ? '0px' : '710px') : '100%'}
          display="flex"
          flexDirection="column"
          css={css`
            right: ${account ? '24px' : '0'};
            top: ${account ? '24px' : '0'};
            z-index: 99;
          `}
        >
          <Box
            display={isWalletMinimised ? 'none' : 'flex'}
            width="-webkit-fill-available"
            height="-webkit-fill-available"
            flexDirection="column"
          >
            <Box
              width="-webkit-fill-available"
              display="flex"
              alignItems="center"
              justifyContent="flex-end"
              padding="spacing-xxs spacing-xxs"
              css={css`
                border-top-right-radius: ${account ? '10px' : '0px'};
                border-top-left-radius: ${account ? '10px' : '0px'};
                background-color: ${account ? '#e3e3e3' : '#17181B'};
              `}
            >
              {account ? (
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  cursor="pointer"
                  onClick={() => setMinimiseWallet(true)}
                  borderRadius="radius-round"
                  height="14px"
                  width="14px"
                  css={css`
                    background-color: #ffbb16;
                  `}
                >
                  <Dash color="icon-primary" size={12} />
                </Box>
              ) : (
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="flex-end"
                  cursor="pointer"
                  padding="spacing-none spacing-sm"
                  onClick={() => {
                    setWalletVisibility(false);
                  }}
                >
                  <Cross size={20} color="icon-secondary" />
                </Box>
              )}
            </Box>
            <iframe
              src={`${config.WALLET_URL[env]}/wallet?app=${window.location.origin}`}
              allow="publickey-credentials-create; publickey-credentials-get"
              ref={iframeRef}
              style={{
                border: 'none',
                width: '-webkit-fill-available',
                height: '-webkit-fill-available',
                borderBottomRightRadius: account ? '10px' : '0px',
                borderBottomLeftRadius: account ? '10px' : '0px',
              }}
            />
          </Box>
        </Box>
      ) : null}
    </>
  );
};

export { PushWalletIFrame };
