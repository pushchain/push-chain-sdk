import React, { FC } from 'react';
import { Box, Text } from 'shared-components';
import styled from 'styled-components';

type TransactionSnippetProps = {
  heading: string;
  transactionData?: string;
  signature?: string;
};

const TransactionSnippet: FC<TransactionSnippetProps> = ({
  heading,
  transactionData,
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
      maxWidth="650px"
    >
      <Text variant="h4-semibold">{heading}:</Text>
      {transactionData && <TxContainer>{transactionData}</TxContainer>}
      {signature && (
        <Text variant="bs-regular" wrap color="text-tertiary">
          {signature}
        </Text>
      )}
    </Box>
  );
};

export { TransactionSnippet };

const TxContainer = styled.pre`
  color: #8c93a0;
  word-break: break-word;
`;
