import React from 'react';
import { Box } from 'shared-components';
import { LandingPageLeftComponent } from './components/LandingPageLeftComponent';
import { LandingPageBanner } from './components/LandingPageBanner';

const LandingPageScreen = () => {
  return (
    <Box
      display="flex"
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
      alignItems="center"
      margin="spacing-xl spacing-none"
    >
      <LandingPageLeftComponent />
      <Box display={{ initial: 'block', ml: 'none' }}>
        <LandingPageBanner height="702px" width="425px" />
      </Box>
    </Box>
  );
};

export { LandingPageScreen };
