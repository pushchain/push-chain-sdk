import React from 'react';
import { Box, Button } from 'shared-components';
import { centerMaskString, convertCaipToObject } from '../../../helpers';
import { useGlobalContext } from '../../../context/GlobalContext';

const SimulateHeader = () => {
  const { account } = useGlobalContext();

  const { result } = convertCaipToObject(account!);
  console.log('Result Address', result);

  return (
    <Box display="flex" justifyContent="end" width="100%">
      <Button variant="tertiary">
        {centerMaskString(result.address as string)}
      </Button>
    </Box>
  );
};

export { SimulateHeader };
