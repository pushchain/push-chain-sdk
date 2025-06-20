import React, { useState } from 'react';
import { Alert, Box, Button, Front, Text } from 'shared-components';
import { css } from 'styled-components';
import { centerMaskString } from '../../../helpers';
import { TransactionSnippet } from '../../../common/components';
import { mockTransaction } from '../../../common/constants';
import { usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';

const MockSendTransaction = () => {
  const { pushChainClient, isLoading } = usePushChainClient();
  const { universalAccount } = usePushWalletContext();

  const [isSendingTxn, setIsSendingTxn] = useState(false);
  const [txnHash, setTxnHash] = useState<string | null>(null);
  const [txnError, setTxnError] = useState<unknown | null>(null);

  const handleSendTransaction = async () => {
    try {
      if (pushChainClient && universalAccount) {
        setIsSendingTxn(true);
        // const txHash = await pushChainClient.universal.sendTransaction({
        //   target: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',
        //   value: BigInt(2),
        // });

        const res = await pushChainClient.universal.sendTransaction({
          to: '0x68F8b46e4cD01a7648393911E734d99d34E6f107',
          value: BigInt(1),
          data: '0x',
        });

        setTxnHash(res.transactionHash);
        setIsSendingTxn(false);
        setTxnError(null);
      }
    } catch (error) {
      console.log('Error in sending transaction', error);
      setIsSendingTxn(false);
      setTxnError(error);
      setTxnHash(null);
    }
  };

  const handleViewOnScan = () => {
    if (txnHash) {
      window.open(`https://scan.push.org/transactions/${txnHash}`, '_blank');
    }
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-lg"
      backgroundColor="surface-primary"
      border="border-sm solid stroke-tertiary"
      borderRadius="radius-lg"
      alignSelf="stretch"
      alignItems="center"
      justifyContent="center"
      padding={{ initial: 'spacing-lg', ml: 'spacing-sm' }}
    >
      {txnHash && (
        <Box width="100%">
          <Alert
            variant="info"
            description={`Tx sent - ${centerMaskString(txnHash)}`}
            actionText="View on Scan"
            onAction={handleViewOnScan}
            onClose={() => {
              setTxnHash(null);
            }}
          />
        </Box>
      )}

      {txnError !== null && (
        <Box width="100%">
          <Alert
            variant="error"
            heading="Error in sending Transaction"
            onClose={() => {
              setTxnError(null);
            }}
          />
        </Box>
      )}

      <TransactionSnippet
        heading="Mock Unsigned Transaction Data"
        transactionData={mockTransaction}
      />

      <Box width={{ initial: '350px', ml: '300px' }}>
        {!isLoading && (
          <Button
            variant="primary"
            size="large"
            block
            disabled={isSendingTxn}
            onClick={() => handleSendTransaction()}
          >
            {isSendingTxn ? 'Sending Transaction' : 'Send Transaction'}
          </Button>
        )}
      </Box>
      <a href="https://scan.push.org/transactions" target="_blank">
        <Box
          display="flex"
          flexDirection="row"
          gap="spacing-xxs"
          width="100%"
          justifyContent="center"
          cursor="pointer"
          css={css`
            &:hover {
              text-decoration: underline;
            }
          `}
        >
          <Text variant="bl-semibold" color="text-brand-medium">
            See all txs on Push Network using Push Scan
          </Text>
          <Front color="icon-brand-medium" size={24} />
        </Box>
      </a>
    </Box>
  );
};

export { MockSendTransaction };
