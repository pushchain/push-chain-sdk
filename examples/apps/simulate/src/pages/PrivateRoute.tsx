import React, { ReactNode } from 'react';
import { useGlobalContext } from '../context/GlobalContext';
import { Navigate } from 'react-router-dom';

const PrivateRoute = ({ children }: { children: ReactNode }) => {
  const { account } = useGlobalContext();

  console.log('Account in Private route ', account);

  if (account) return <>{children}</>;

  return <Navigate to={'/'} />;
};

export { PrivateRoute };
