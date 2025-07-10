import { Box, Text } from 'shared-components';
import { MockSendTransaction } from './components/MockSendTransaction';
import { MockSignTransaction } from './components/MockSignTransaction';
import { SimulateTxText } from '../landingPage/components/SimulateTxText';

const SimulateModule = () => {
  return (
    <Box
      margin="spacing-xxl spacing-none spacing-none spacing-none"
      display="flex"
      flexDirection="column"
      gap="spacing-lg"
    >
      <Box alignSelf="center">
        <a href="https://push.org/chain" target="_blank">
          <SimulateTxText height="70px" width="300px" />
        </a>
      </Box>

      <Box
        display="flex"
        flexDirection="column"
        gap="spacing-lg"
        justifyContent="center"
        alignItems="center"
        minWidth={{ initial: '760px', ml: 'auto' }}
        maxWidth={{ initial: 'auto', ml: '350px' }}
      >
        <MockSendTransaction />
        {/* <Text variant="h4-semibold"> or Sign a message</Text>
        <MockSignTransaction /> */}
      </Box>
    </Box>
  );
};

export { SimulateModule };
