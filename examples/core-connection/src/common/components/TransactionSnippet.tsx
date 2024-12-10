import React, { FC } from 'react';
import { Box, Text, TextArea } from 'shared-components';
import { css } from 'styled-components';
import { Transaction } from '@pushprotocol/push-chain/src/lib/generated/tx';

type TransactionSnippetProps = {
  heading: string;
  transactionData: Transaction | null;
  signature?: string;
};

const TransactionSnippet: FC<TransactionSnippetProps> = ({
  heading,
  transactionData = null,
  signature,
}) => {
  return (
    <Box
      display="flex"
      flexDirection="column"
      padding="spacing-md"
      borderRadius="radius-md"
      backgroundColor="surface-secondary"
      justifyContent="center"
      gap="spacing-xs"
      alignSelf="stretch"
      maxWidth={{ initial: '650px', ml: 'auto' }}
    >
      <Text variant="h4-semibold">{heading}:</Text>
      {transactionData !== null && (
        <TextArea
          value={JSON.stringify(transactionData, null, 2)}
          onChange={() => {}}
          resizable={false}
          numberOfLines={38}
          css={css`
            height: auto;
          `}
        />
      )}
      {signature && (
        <Text variant="bs-regular" wrap color="text-tertiary">
          {signature}
        </Text>
      )}
    </Box>
  );
};

export { TransactionSnippet };
