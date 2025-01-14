import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Web3OnboardProvider } from "@web3-onboard/react";
import web3Onboard from "./services/walletService";
import {
  ENV,
  PushWalletProvider,
  PushWalletIFrame,
} from '@pushprotocol/pushchain-ui-kit';
import App from "./App.jsx";
import { ConfessionProvider } from "./context/ConfessionContext.jsx";


createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Web3OnboardProvider web3Onboard={web3Onboard}>
    <PushWalletProvider env={ENV.PROD}>
      <ConfessionProvider>
        <PushWalletIFrame />
        <App />
      </ConfessionProvider>
    </PushWalletProvider>
    </Web3OnboardProvider>
  </StrictMode>
);
