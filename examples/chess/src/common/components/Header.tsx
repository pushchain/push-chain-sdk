import { FC } from 'react';
import { Box, css } from 'shared-components';
import {
  PushWalletButton,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';

const Header: FC = () => {
  const { universalAddress } = usePushWalletContext();
  return (
    <Box
      position="sticky"
      width="100%"
      display="flex"
      padding="spacing-xs spacing-xs"
      alignItems="center"
      justifyContent="flex-end"
      css={css`
        border-bottom: 1px solid #313338;
        box-sizing: border-box;
      `}
    >
      <PushWalletButton universalAddress={universalAddress} />
    </Box>
  );
};

export { Header };
