import React from 'react';
import { Box } from 'shared-components';
import SimulateTxBanner from '/public/SimulateTxBanner.png';

const LandingPageBanner = () => {
  return (
    <Box>
      <img src={SimulateTxBanner} />
    </Box>
  );
};

export { LandingPageBanner };
