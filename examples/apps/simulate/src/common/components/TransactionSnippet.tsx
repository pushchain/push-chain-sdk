import { ExecuteParams } from '@pushchain/core/src/lib/orchestrator/orchestrator.types';
import React, { FC, useState } from 'react';
import { Box, Text, TextArea } from 'shared-components';
import { css } from 'styled-components';

type TransactionSnippetProps = {
  heading: string;
  transactionData: ExecuteParams;
  setTransactionData: React.Dispatch<React.SetStateAction<ExecuteParams>>;
  signature?: string;
};

const stringifyWithBigInt = (obj: any, spacing = 2) => {
  return JSON.stringify(
    obj,
    (_, value) => (typeof value === 'bigint' ? `BigInt(${value.toString()})` : value),
    spacing
  );
}

const parseWithBigInt = (text: string) => {
  return JSON.parse(text, (_, value) => {
    if (typeof value === 'string' && /^BigInt\((\d+)\)$/.test(value)) {
      return BigInt(value.match(/^BigInt\((\d+)\)$/)![1]);
    }
    return value;
  });
}

const TransactionSnippet: FC<TransactionSnippetProps> = ({
  heading,
  transactionData = null,
  setTransactionData,
  signature,
}) => {
  const [rawText, setRawText] = useState(() => stringifyWithBigInt(transactionData));

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setRawText(newText);

    try {
      const parsed = parseWithBigInt(newText);
      setTransactionData(parsed);
    } catch (error) {
      console.error("Invalid JSON:", error);
      // Optional: show error to user
    }
  };


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
          value={rawText}
          onChange={handleChange}
          resizable={false}
          numberOfLines={20}
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
