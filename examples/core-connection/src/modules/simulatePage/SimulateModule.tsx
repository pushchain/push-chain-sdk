import React from 'react';
import { Box, Text } from 'shared-components';
import SimulareTxText from '/public/SimulateTxText.png';
import { MockSendTransaction } from './components/MockSendTransaction';
import { MockSignTransaction } from './components/MockSignTransaction';

const SimulateModule = () => {
  return (
    <Box
      minWidth="760px"
      margin="spacing-xxl spacing-none spacing-none spacing-none"
      display="flex"
      flexDirection="column"
      gap="spacing-lg"
    >
      <Box alignSelf="center">
        <img src={SimulareTxText} width={256} height={67} />
      </Box>

      <Box
        display="flex"
        flexDirection="column"
        gap="spacing-lg"
        justifyContent="center"
        alignItems="center"
      >
        <MockSendTransaction />
        <Text variant="h4-semibold"> or Sign a message</Text>
        <MockSignTransaction />
      </Box>
    </Box>
  );
};

export { SimulateModule };
