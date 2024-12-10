import React from 'react';
import { css } from 'styled-components';
import { Box, Button, Front, Text } from 'shared-components';
import { ConnectPushWalletButton } from '@pushprotocol/pushchain-ui-kit';
import { useGlobalContext } from '../../../context/GlobalContext';
import { LandingPageBanner } from './LandingPageBanner';
import { SimulateTxText } from './SimulateTxText';

const LandingPageLeftComponent = () => {
  const { pushNetwork, mockTx } = useGlobalContext();

  const featuresCard = [
    {
      id: 1,
      text: 'Test and simulate transactions on the Push chain.',
    },
    {
      id: 2,
      text: 'Send tx from any chain of your choice(ETH, Solana, Push).',
    },
    {
      id: 3,
      text: 'Experience wallet abstraction and the future of web3',
    },
  ];

  const StarIcon = () => {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="28"
        height="29"
        viewBox="0 0 28 29"
        fill="none"
      >
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M15.3524 1.8901C14.8155 0.661161 13.0473 0.674174 12.529 1.91088L10.7439 6.16975C9.57977 8.94721 7.3245 11.1388 4.49458 12.2426L0.970016 13.6173C-0.32334 14.1218 -0.323339 15.9305 0.970021 16.4349L4.52088 17.8199C7.33613 18.918 9.58332 21.0928 10.7527 23.8512L12.5313 28.0465C13.0524 29.2756 14.8101 29.2886 15.3498 28.0674L17.2695 23.7235C18.4543 21.0427 20.6628 18.9329 23.4143 17.8534L27.0328 16.4338C28.3224 15.9279 28.3224 14.1244 27.0328 13.6184L23.4411 12.2093C20.6746 11.1239 18.4576 8.99721 17.2778 6.29686L15.3524 1.8901Z"
          fill="#C742DD"
        />
      </svg>
    );
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-xxl"
      maxWidth={{ initial: '475px', ml: 'auto' }}
    >
      <Box display="flex" flexDirection="column" gap="spacing-md">
        <a href="https://gov.push.org/" target="_blank">
          <Box display={{ initial: 'flex', ml: 'none' }}>
            <Button trailingIcon={<Front />} variant="outline" size="small">
              Push Chain Governance Proposal is Live
            </Button>
          </Box>
          <Box display={{ initial: 'none', ml: 'flex' }}>
            <Button
              trailingIcon={<Front />}
              variant="outline"
              size="extraSmall"
            >
              Push Chain Governance Proposal is Live
            </Button>
          </Box>
        </a>

        <Box display={{ initial: 'flex', ml: 'none' }}>
          <SimulateTxText height="80px" width="400px" />
        </Box>
        <Box display={{ initial: 'none', ml: 'flex' }}>
          <SimulateTxText height="80px" width="300px" />
        </Box>

        <Box display={{ initial: 'flex', ml: 'none' }}>
          <Text variant="h4-regular">
            An app that lets you simulate transactions on the Push chain, test
            signing, and send mock data with ease.
          </Text>
        </Box>

        <Box display={{ initial: 'none', ml: 'flex' }}>
          <Text variant="h4-regular" textAlign="center">
            An app that lets you simulate transactions on the Push chain, test
            signing, and send mock data with ease.
          </Text>
        </Box>

        <Box
          display={{ initial: 'none', ml: 'flex' }}
          alignItems="center"
          justifyContent="center"
        >
          <LandingPageBanner height="290px" width="175px" />
        </Box>
      </Box>

      <Box display="flex" flexDirection="column" gap="spacing-sm">
        <Box display="flex" flexDirection="column" gap="spacing-sm">
          {pushNetwork && mockTx && (
            <Box display="flex" alignItems="center" justifyContent="center">
              <ConnectPushWalletButton />
            </Box>
          )}

          <a href="https://push.org/chain" target="_blank">
            <Box
              display={{ initial: 'flex', ml: 'none' }}
              flexDirection="row"
              gap="spacing-xxs"
              width="100%"
              justifyContent="center"
            >
              <Text variant="bl-semibold" color="text-brand-medium">
                Learn more about Push Chain
              </Text>
              <Front color="icon-brand-medium" size={24} />
            </Box>
            <Box
              flexDirection="row"
              gap="spacing-xxs"
              width="100%"
              justifyContent="center"
              display={{ initial: 'none', ml: 'flex' }}
            >
              <Text variant="bl-semibold" color="text-brand-medium">
                Learn more about Push Chain
              </Text>
              <Front color="icon-brand-medium" size={24} />
            </Box>
          </a>
        </Box>

        <Box>
          {featuresCard.map((item) => (
            <Box
              key={item.id}
              display="flex"
              flexDirection="row"
              gap="spacing-md"
              padding="spacing-md spacing-none"
              css={css`
                border-bottom: 1px solid #000;
              `}
            >
              <StarIcon />
              <Text variant="h4-regular">{item.text}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export { LandingPageLeftComponent };
