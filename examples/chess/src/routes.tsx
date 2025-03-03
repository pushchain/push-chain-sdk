import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box } from 'shared-components';
import LandingPage from './pages/LandingPage';
import ChessPage from './pages/ChessPage';
import HomePage from './pages/HomePage';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import BotPage from './pages/BotPage';

const AppRoutes = () => {
  const { universalAddress } = usePushWalletContext();

  useEffect(() => {
    console.log('check');
  }, [universalAddress]);

  console.log(universalAddress);

  return (
    <Box display="flex" justifyContent="center" minHeight="100vh">
      <Routes>
        <Route
          path="/"
          element={universalAddress ? <Navigate to="/home" /> : <LandingPage />}
        />
        <Route
          path="/home"
          element={universalAddress ? <HomePage /> : <Navigate to="/" />}
        />
        <Route
          path="/chess"
          element={universalAddress ? <ChessPage /> : <Navigate to="/" />}
        />
        <Route
          path="/bot"
          element={universalAddress ? <BotPage /> : <Navigate to="/" />}
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Box>
  );
};

export default AppRoutes;
