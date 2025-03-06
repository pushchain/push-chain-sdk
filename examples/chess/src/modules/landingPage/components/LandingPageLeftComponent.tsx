import { Box, Button, Front, Sale, Text, css } from 'shared-components';
import { PushWalletButton } from '@pushprotocol/pushchain-ui-kit';
import { SimulateTxText } from './SimulateTxText';

const LandingPageLeftComponent = () => {
  const featuresCard = [
    {
      id: 1,
      text: 'Play Across Any Chain – No limits, no barriers—just pure strategy!',
    },
    {
      id: 2,
      text: 'On-Chain Transparency – Every move is recorded for fair, cheat-proof gameplay!',
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
        <a
          href="https://snapshot.box/#/s:pushdao.eth/proposal/0xa4a301c9a346356326d59e425245459d9fbde71b02aabc49a4ce191f0504f66a"
          target="_blank"
        >
          <Box display={{ initial: 'flex', tb: 'none' }}>
            <Button trailingIcon={<Front />} variant="outline" size="small">
              Push Chain proposal has successfully passed.
            </Button>
          </Box>
          <Box display={{ initial: 'none', tb: 'flex' }}>
            <Button
              trailingIcon={<Front />}
              variant="outline"
              size="extraSmall"
            >
              Push Chain proposal has successfully passed
            </Button>
          </Box>
        </a>

        <a href="https://push.org/chain" target="_blank">
          <Box display={{ initial: 'flex', tb: 'none' }}>
            <SimulateTxText height="124px" width="497px" />
          </Box>
          <Box display={{ initial: 'none', tb: 'flex' }}>
            <SimulateTxText height="86px" width="343px" />
          </Box>
        </a>

        <Box display={{ initial: 'flex', tb: 'none' }}>
          <Text variant="h4-regular">
            Challenge players from any chain in a high-stakes, trustless chess
            showdown! With on-chain moves and seamless cross-chain battles, it’s
            time to take chess to the next level! 🚀
          </Text>
        </Box>

        <Box display={{ initial: 'none', tb: 'flex' }}>
          <Text variant="h4-regular" textAlign="center">
            Challenge players from any chain in a high-stakes, trustless chess
            showdown! With on-chain moves and seamless cross-chain battles, it’s
            time to take chess to the next level! 🚀
          </Text>
        </Box>
        {/* <Box
          display={{ initial: 'none', tb: 'flex' }}
          alignItems="center"
          justifyContent="center"
        >
          <LandingPageBanner height="343px" />
        </Box> */}
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
                backgroundColor: '#000000',
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
                <Sale size={28} color="icon-primary" />
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
