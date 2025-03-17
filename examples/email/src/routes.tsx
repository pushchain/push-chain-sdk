import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { Box } from 'shared-components';
import EmailPage from './pages/EmailPage';
import LandingPage from './pages/LandingPage';

const AppRoutes = () => {
  const { universalAddress } = usePushWalletContext();
  const isTablet = window.matchMedia('(max-width: 768px)').matches;
  return (
    <Box display="flex" justifyContent="center" minHeight="100vh">
      <Routes>
        <Route
          path="/"
          element={
            universalAddress ? (
              isTablet ? (
                <Navigate to="/inbox" />
              ) : (
                <Navigate to="/inbox/welcome" />
              )
            ) : (
              <LandingPage />
            )
          }
        />

        <Route
          path="/"
          element={universalAddress ? <EmailPage /> : <Navigate to="/" />}
        >
          <Route path="inbox" element={<EmailPage />} />
          <Route path="inbox/:id" element={<EmailPage />} />
          <Route path="sent" element={<EmailPage />} />
          <Route path="sent/:id" element={<EmailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Box>
  );
};

export default AppRoutes;
