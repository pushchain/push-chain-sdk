import { getConfessions } from "./getConfessions";
import { ethers } from "ethers";

export const getSentConfessions = async (wallet) => {
  try {
    if (typeof wallet == "string") {
      // Fetch all confessions
      const allConfessions = await getConfessions();
      if (!Array.isArray(allConfessions)) {
        throw new Error(
          "Unexpected API response format: Confessions is not an array"
        );
      }
      
      // Filter confessions by wallet address
      const result = allConfessions.filter((item) => {
        if (!item.address) {
          console.warn("Skipping confession with missing address:", item);
          return false;
        }
        const address = item.address;
        return address === wallet;
      });

      return result;
    } else {
      // Ensure wallet and accounts are valid
      if (!wallet || !wallet.accounts || wallet.accounts.length === 0) {
        throw new Error("Invalid wallet or wallet not connected");
      }

      // Fetch all confessions
      const allConfessions = await getConfessions();
      if (!Array.isArray(allConfessions)) {
        throw new Error(
          "Unexpected API response format: Confessions is not an array"
        );
      }

      // Normalize address
      const normalizedAddress = ethers.getAddress(wallet.accounts[0]?.address);

      // Filter confessions by wallet address
      const result = allConfessions.filter((item) => {
        if (!item.address) {
          console.warn("Skipping confession with missing address:", item);
          return false;
        }
        const address = ethers.getAddress(item.address);
        return address === normalizedAddress;
      });

      return result;
    }
  } catch (error) {
    console.error("Error in getSentConfessions:", error.message);
    return []; // Return an empty array to avoid breaking the UI
  }
};
