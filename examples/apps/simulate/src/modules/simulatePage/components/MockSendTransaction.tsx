import React, { useState } from 'react';
import { Alert, Box, Button, Front, Text } from 'shared-components';
import { css } from 'styled-components';
import { centerMaskString } from '../../../helpers';
import { TransactionSnippet } from '../../../common/components';
import { mockTransaction } from '../../../common/constants';
import {
  usePushChainClient,
  usePushWalletContext,
} from '@pushchain/ui-kit';
import { ExecuteParams } from '@pushchain/core/src/lib/orchestrator/orchestrator.types';

const MockSendTransaction = () => {
  const { pushChainClient, isInitialized } = usePushChainClient();
  const { universalAccount } = usePushWalletContext();

  const [isSendingTxn, setIsSendingTxn] = useState(false);
  const [txnHash, setTxnHash] = useState<string | null>(null);
  const [txnError, setTxnError] = useState<unknown | null>(null);
  const [txnData, setTxnData] = useState<ExecuteParams>(mockTransaction);

  const handleSendTransaction = async () => {
    console.log(txnData, mockTransaction);
    try {
      if (pushChainClient && universalAccount) {
        setIsSendingTxn(true);
        // const txHash = await pushChainClient.universal.sendTransaction({
        //   target: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',
        //   value: BigInt(2),
        // });

        const res = await pushChainClient.universal.sendTransaction(txnData);

        setTxnHash(res.hash);
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
    if (txnHash && pushChainClient) {
      window.open(pushChainClient.explorer.getTransactionUrl(txnHash), '_blank');
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
            actionText="View on Explorer"
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
        heading="Send Universal Transaction Data"
        transactionData={txnData}
        setTransactionData={setTxnData}
      />

      <Box width={{ initial: '350px', ml: '300px' }}>
        {isInitialized && (
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
      <a href='https://donut.push.network/txs' target="_blank">
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
            See all txs on Push Network using Push Chain Explorer
          </Text>
          <Front color="icon-brand-medium" size={24} />
        </Box>
      </a>
    </Box>
  );
};

export { MockSendTransaction };
