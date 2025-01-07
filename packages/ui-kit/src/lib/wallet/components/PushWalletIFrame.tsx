import { FC } from 'react';
import { usePushWalletContext } from './PushWalletProvider';
import {
  Box,
  Cross,
  css,
  Dash,
  deviceMediaQ,
  Spinner,
  Text,
} from 'shared-components';
import config from '../../config';

const PushWalletIFrame: FC = () => {
  const {
    env,
    account,
    iframeRef,
    isWalletMinimised,
    isWalletVisible,
    setMinimiseWallet,
    handleUserLogOutEvent,
    isIframeLoading,
    setIframeLoading,
  } = usePushWalletContext();

  return (
    <>
      {isWalletVisible ? (
        <Box
          position="fixed"
          width={{
            initial: isWalletMinimised ? '0px' : account ? '450px' : '100%',
            ml: isWalletMinimised ? '0px' : account ? '96%' : '100%',
          }}
          height={isWalletMinimised ? '0px' : account ? '710px' : '100%'}
          display="flex"
          flexDirection="column"
          css={css`
            right: ${account ? '24px' : '0'};
            top: ${account ? '24px' : '0'};
            z-index: 99;
            background-color: #17181b;
            border-radius: 10px;

            @media (${deviceMediaQ.mobileL}) {
              right: ${account ? '2%' : '0'};
              top: ${account ? '8%' : '0'};
            }
          `}
        >
          {isIframeLoading && (
            <Box
              width="-webkit-fill-available"
              height="-webkit-fill-available"
              flexDirection="column"
              display="flex"
              padding="spacing-xxs spacing-xxs"
              css={css`
                background-color: #17181b;
              `}
            >
              <Box
                display="flex"
                alignItems="center"
                justifyContent="flex-end"
                cursor="pointer"
                padding="spacing-none spacing-sm"
                onClick={() => {
                  handleUserLogOutEvent();
                }}
              >
                <Cross size={20} color="icon-secondary" />
              </Box>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                gap="spacing-sm"
                width="-webkit-fill-available"
                height="-webkit-fill-available"
              >
                <Text variant="bl-semibold" color="text-primary-inverse">
                  Loading...
                </Text>
                <Spinner size="medium" variant="primary" />
              </Box>
            </Box>
          )}
          <Box
            display={isWalletMinimised || isIframeLoading ? 'none' : 'flex'}
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
                    handleUserLogOutEvent();
                  }}
                >
                  <Cross size={20} color="icon-secondary" />
                </Box>
              )}
            </Box>
            <iframe
              src={`${config.WALLET_URL[env]}/auth?app=${window.location.origin}`}
              allow="publickey-credentials-create; publickey-credentials-get"
              ref={iframeRef}
              style={{
                border: 'none',
                width: '-webkit-fill-available',
                height: '-webkit-fill-available',
                borderBottomRightRadius: account ? '10px' : '0px',
                borderBottomLeftRadius: account ? '10px' : '0px',
              }}
              onLoad={() => setIframeLoading(false)}
            />
          </Box>
        </Box>
      ) : null}
    </>
  );
};

export { PushWalletIFrame };
