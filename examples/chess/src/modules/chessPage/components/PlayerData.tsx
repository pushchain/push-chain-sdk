import { trimAddress, ChainIcon, formatTime } from '@/common';
import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
import BlockiesSvg from 'blockies-react-svg';
import { FC } from 'react';
import { Box, Text, css } from 'shared-components';

const PlayerData: FC<{
  universalAddress: UniversalAddress | null;
  timer: number;
}> = ({ universalAddress, timer }) => {
  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      height="42px"
      width="100%"
      maxWidth="615px"
      padding="spacing-none spacing-xs"
      css={css`
        box-sizing: border-box;
      `}
    >
      <Box display="flex" alignItems="center" gap="spacing-xxs">
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
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        padding="spacing-xs"
        borderRadius="radius-xs"
        width="48px"
        css={css`
          background-color: #313134;
        `}
      >
        <Text variant="bm-bold" color="text-primary-inverse">
          {formatTime(timer)}
        </Text>
      </Box>
    </Box>
  );
};

export { PlayerData };
