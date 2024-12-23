import {
  Box,
  Button,
  Front,
  Sale,
  Text,
  Spinner,
  css,
} from 'shared-components';
import { ConnectPushWalletButton } from '@pushprotocol/pushchain-ui-kit';
import { SimulateTxText } from './SimulateTxText';
import { useAppContext } from '@/context/AppContext';

const LandingPageLeftComponent = () => {
  const { pushNetwork } = useAppContext();

  const featuresCard = [
    {
      id: 1,
      text: 'Send and receive emails across multiple blockchain networks without barriers.',
    },
    {
      id: 2,
      text: 'Push Mail brings a seamless web2 experience to web3.',
    },
    {
      id: 3,
      text: 'Maintain a unified inbox across chains for an effortless user experience.',
    },
  ];

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-xxl"
      maxWidth={{ initial: '475px', ml: 'auto' }}
    >
      <Box
        display="flex"
        flexDirection="column"
        gap="spacing-md"
        alignItems={{ ml: 'center' }}
      >
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

        <a href="https://push.org/chain" target="_blank">
          <Box display={{ initial: 'flex', ml: 'none' }}>
            <SimulateTxText height="124px" width="343px" />
          </Box>
          <Box display={{ initial: 'none', ml: 'flex' }}>
            <SimulateTxText height="124px" width="343px" />
          </Box>
        </a>

        <Box display={{ initial: 'flex', ml: 'none' }}>
          <Text variant="h4-regular">
            Push Mail enables seamless communication across any chain. Shared
            state email ensures secure, transparent, and interoperable
            messaging.
          </Text>
        </Box>

        <Box display={{ initial: 'none', ml: 'flex' }}>
          <Text variant="h4-regular" textAlign="center">
            Push Mail enables seamless communication across any chain. Shared
            state email ensures secure, transparent, and interoperable
            messaging.
          </Text>
        </Box>
      </Box>

      <Box display="flex" flexDirection="column" gap="spacing-sm">
        <Box display="flex" flexDirection="column" gap="spacing-sm">
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            width="-webkit-fill-available"
          >
            {pushNetwork ? (
              <ConnectPushWalletButton />
            ) : (
              <Spinner size="medium" variant="primary" />
            )}
          </Box>

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
              <Sale size={28} color="icon-brand-medium" />
              <Text variant="h4-regular" as="span">
                {item.text}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export { LandingPageLeftComponent };
