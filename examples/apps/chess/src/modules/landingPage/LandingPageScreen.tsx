import { Box } from 'shared-components';
import { LandingPageLeftComponent } from './components/LandingPageLeftComponent';
import { useEffect } from 'react';
import { LandingPageBanner } from './components/LandingPageBanner';

const LandingPageScreen = () => {
  useEffect(() => {
    document.body.style.background = '#ffffff';
    return () => {
      document.body.style.background = '';
    };
  }, []);

  return (
    <Box
      display="flex"
      flexDirection="row"
      justifyContent={{ initial: 'space-between', tb: 'center' }}
      width="100%"
      alignItems="center"
      margin="spacing-xl spacing-none"
    >
      <LandingPageLeftComponent />
      <Box display={{ initial: 'block', tb: 'none' }}>
        <LandingPageBanner height="702px" />
      </Box>
    </Box>
  );
};

export { LandingPageScreen };
