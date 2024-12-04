import React, { createContext, useState } from "react";

// Create Context
export const ConfessionContext = createContext();

// Create Provider Component
export const ConfessionProvider = ({ children }) => {
  const [confession, setConfession] = useState("");
  const [isPushWallet, setIsPushWallet] = useState(false);
  const [pushWalletAddress, setPushWalletAddress] = useState("");
  const [user, setUser] = useState(null);

  return (
    <ConfessionContext.Provider
      value={{
        confession,
        setConfession,
        isPushWallet,
        setIsPushWallet,
        pushWalletAddress,
        setPushWalletAddress,
        user,
        setUser,
      }}
    >
      {children}
    </ConfessionContext.Provider>
  );
};
