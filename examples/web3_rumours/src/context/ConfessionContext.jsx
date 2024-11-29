import React, { createContext, useState } from "react";

// Create Context
export const ConfessionContext = createContext();

// Create Provider Component
export const ConfessionProvider = ({ children }) => {
  const [confession, setConfession] = useState("");

  return (
    <ConfessionContext.Provider value={{ confession, setConfession }}>
      {children}
    </ConfessionContext.Provider>
  );
};
