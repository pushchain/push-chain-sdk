import { FC } from 'react';
import { Box, PushLogo, Text, css } from 'shared-components';
import {
  TogglePushWalletButton,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';

const Header: FC = () => {
  const { account } = usePushWalletContext();

  return (
    <Box
      position="fixed"
      width="100%"
      display="flex"
      padding="spacing-xs spacing-xs"
      alignItems="center"
      justifyContent="space-between"
      backgroundColor="surface-primary"
      css={css`
        border-bottom: 1px solid var(--stroke-secondary);
      `}
    >
      <Box display="flex" alignItems="center" gap="spacing-xs">
        <Box display="flex" alignItems="center" gap="spacing-xxs">
          <PushLogo height={40} />
          <Text variant="h2-bold" display={{ initial: 'block', ml: 'none' }}>
            Push
          </Text>
        </Box>
        <Text variant="h4-semibold" display={{ initial: 'block', ml: 'none' }}>
          Email
        </Text>
      </Box>
      <Box>{account && <TogglePushWalletButton account={account} />}</Box>
    </Box>
  );
};

export { Header };
