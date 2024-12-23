import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/login';
import LoggedInView from './components/logged-in-view';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

const AppRoutes = () => {
  const { account } = usePushWalletContext();
  return (
    <Routes>
      <Route
        path="/"
        element={account ? <Navigate to="/inbox/welcome" /> : <Login />}
      />

      <Route
        path="/"
        element={account ? <LoggedInView /> : <Navigate to="/" />}
      >
        <Route path="inbox" element={<LoggedInView />} />
        <Route path="inbox/:id" element={<LoggedInView />} />
        <Route path="sent" element={<LoggedInView />} />
        <Route path="sent/:id" element={<LoggedInView />} />
      </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

export default AppRoutes;
