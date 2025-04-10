import { trimAddress, ChainIcon } from '@/common';
import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
import BlockiesSvg from 'blockies-react-svg';
import { FC } from 'react';
import { Box, css, Text } from 'shared-components';

const PlayerData: FC<{
  universalAddress: UniversalAddress | null;
}> = ({ universalAddress }) => {
  return (
    <Box
      display="flex"
      alignItems="center"
      height="42px"
      gap="spacing-xxs"
      width="100%"
      maxWidth="615px"
      padding="spacing-none spacing-xs"
      css={css`
        box-sizing: border-box;
      `}
    >
      <Box
        width="32px"
        height="32px"
        borderRadius="radius-round"
        overflow="hidden"
        alignSelf="center"
      >
        <BlockiesSvg address={universalAddress?.address || ''} />
      </Box>
      <Text variant="bs-bold" color="text-primary-inverse">
        {trimAddress(universalAddress?.address || '')}
      </Text>
      <ChainIcon chainId={universalAddress?.chainId || ''} />
    </Box>
  );
};

export { PlayerData };
