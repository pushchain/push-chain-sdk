import { FC } from 'react';
import { Box, PushLogo, Text } from 'shared-components';
import { css } from 'styled-components';
import {
  TogglePushWalletButton,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';

const Header: FC = () => {
  const { account } = usePushWalletContext();

  return (
    <Box
      width="100%"
      display="flex"
      padding="spacing-xs spacing-xs"
      alignItems="center"
      justifyContent="space-between"
      css={css`
        border-bottom: 1px solid var(--stroke-secondary);
      `}
    >
      <Box display="flex" alignItems="center" gap="spacing-xs">
        <Box display="flex" alignItems="center" gap="spacing-xxs">
          <PushLogo height={40} />
          <Text variant="h2-bold">Push</Text>
        </Box>
        <Text
          variant="h4-semibold"
          css={css`
            display: block;
            @media (max-width: 768px) {
              display: none;
            }
          `}
        >
          Email
        </Text>
      </Box>
      <Box>{account && <TogglePushWalletButton account={account} />}</Box>
    </Box>
  );
};

export { Header };
