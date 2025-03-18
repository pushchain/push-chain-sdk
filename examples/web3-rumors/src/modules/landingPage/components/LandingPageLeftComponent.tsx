import { Box, Button, Front, Union, Text, css } from 'shared-components';
import { PushWalletButton } from '@pushprotocol/pushchain-ui-kit';
import { SimulateTxText } from './SimulateTxText';
import { LandingPageBanner } from './LandingPageBanner';

const LandingPageLeftComponent = () => {
  const featuresCard = [
    {
      id: 1,
      text: 'No sign-ups or personal data. Just connect to post and explore anonymously.',
    },
    {
      id: 2,
      text: 'Community-driven voting ensures only the most engaging secrets rise to the top.',
    },
    {
      id: 3,
      text: 'Posts are permanently stored on the blockchain, ensuring authenticity.',
    },
  ];

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-xxl"
      maxWidth={{ initial: '475px', tb: 'auto' }}
      margin="spacing-xxs"
    >
      <Box
        display="flex"
        flexDirection="column"
        gap="spacing-md"
        alignItems={{ tb: 'center' }}
      >
        <a href="https://x.com/PushChain" target="_blank">
          <Box display={{ initial: 'flex', tb: 'none' }}>
            <Button trailingIcon={<Front />} variant="outline" size="small">
              Push Chain Devnet Drop S2 coming 20 Mar, 2025
            </Button>
          </Box>
          <Box display={{ initial: 'none', tb: 'flex' }}>
            <Button
              trailingIcon={<Front />}
              variant="outline"
              size="extraSmall"
            >
              Push Chain Devnet Drop S2 coming 20 Mar, 2025
            </Button>
          </Box>
        </a>

        <a href="https://push.org/chain" target="_blank">
          <Box display={{ initial: 'flex', tb: 'none' }}>
            <SimulateTxText height="124px" width="343px" />
          </Box>
          <Box display={{ initial: 'none', tb: 'flex' }}>
            <SimulateTxText height="124px" width="343px" />
          </Box>
        </a>

        <Box display={{ initial: 'flex', tb: 'none' }}>
          <Text variant="h4-regular">
            Whispers meet blockchain. Share secrets, spread rumors, or uncover
            truths in a completely anonymous and tamper-proof environment,
            across users of any chain.
          </Text>
        </Box>

        <Box display={{ initial: 'none', tb: 'flex' }}>
          <Text variant="h4-regular" textAlign="center">
            Whispers meet blockchain. Share secrets, spread rumors, or uncover
            truths in a completely anonymous and tamper-proof environment,
            across users of any chain.
          </Text>
        </Box>
        <Box
          display={{ initial: 'none', tb: 'flex' }}
          alignItems="center"
          justifyContent="center"
        >
          <LandingPageBanner height="343px" />
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
            <PushWalletButton
              universalAddress={null}
              title="Connect to Push Wallet"
              styling={{
                width: 'inherit',
                backgroundColor: '#0056D0',
              }}
            />
          </Box>

          <a href="https://push.org/chain" target="_blank">
            <Box
              display={{ initial: 'flex', tb: 'none' }}
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
              display={{ initial: 'none', tb: 'flex' }}
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
              alignItems="center"
            >
              <Box height="28px" width="28px">
                <Union size={28} svgProps={{ color: '#0056D0' }} />
              </Box>
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
