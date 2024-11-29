// import { useEffect } from 'react';
// import { generateKeyPair } from '../encryption';
// import { usePokerGameContext } from './usePokerGameContext.tsx';
// import usePushWalletSigner from './usePushSigner.tsx';

// /**
//  * Submit current player public key to the network so other players can use it to encrypt the deck
//  */
// export default function useSubmitPlayerPublicKey() {
//   const { game, myEncryptionKeys, setMyEncryptionKeys, pokerService } =
//     usePokerGameContext();
//   const { pushWalletSigner } = usePushWalletSigner();

//   useEffect(() => {
//     (async () => {
//       if (!myEncryptionKeys || !pokerService || !game || !pushWalletSigner)
//         return;
//       const keys = generateKeyPair();
//       await pokerService.submitPublicKey(
//         keys.publicKey,
//         [...game.players.keys()],
//         pushWalletSigner
//       );
//       setMyEncryptionKeys(keys);
//     })();
//   }, [
//     myEncryptionKeys,
//     pokerService,
//     game,
//     pushWalletSigner,
//     setMyEncryptionKeys,
//   ]);
// }


// import { useEffect, useState } from 'react';
// import { generateKeyPair } from '../encryption';
// import { usePokerGameContext } from './usePokerGameContext.tsx';
// import usePushWalletSigner from './usePushSigner.tsx';

// /**
//  * Submit current player public key to the network so other players can use it to encrypt the deck,
//  * and continuously poll for game state updates.
//  */
// export default function useSubmitPlayerPublicKey() {
//   const { game, myEncryptionKeys, setMyEncryptionKeys, pokerService, setGame, gameTransactionHash } =
//     usePokerGameContext();
//   const { pushWalletSigner } = usePushWalletSigner();
//   const [isPolling, setIsPolling] = useState(false); // Manage polling state
//   const [isTrying, setIsTrying] = useState(false); // Prevent multiple submissions

//   useEffect(() => {
//     const pollPlayers = async () => {
//       if (!game || !pokerService || isPolling) return;

//       setIsPolling(true); // Mark polling as active
//       try {
//         const updatedPlayers = await pokerService.getPlayerOrderForTable({
//           txHash: gameTransactionHash,
//           creator: game.creator,
//         });

//         if (updatedPlayers) {
//           // Clone and update game state
//           const updatedGame = { ...game };
//           updatedGame.players = new Map(game.players);
//           updatedPlayers.forEach((playerAddress) => {
//             if (!updatedGame.players.has(playerAddress)) {
//               updatedGame.players.set(playerAddress, {
//                 chips: 100,
//                 cards: [],
//               });
//             }
//           });
//           setGame(updatedGame); // Update game state
//         }
//       } catch (error) {
//         console.error("Error fetching player order during polling:", error);
//       } finally {
//         setIsPolling(false); // Mark polling as complete
//       }
//     };

//     if (!myEncryptionKeys && !isTrying && pokerService && game && pushWalletSigner) {
//       const submitPublicKey = async () => {
//         setIsTrying(true); // Prevent duplicate submissions
//         try {
//           const keys = generateKeyPair();
//           await pokerService.submitPublicKey(
//             keys.publicKey,
//             [...game.players.keys()],
//             pushWalletSigner
//           );
//           setMyEncryptionKeys(keys); // Stop polling after successful key submission
//         } catch (error) {
//           console.error("Error submitting public key:", error);
//         } finally {
//           setIsTrying(false); // Allow retry if needed
//         }
//       };

//       submitPublicKey();
//     }

//     // Polling interval
//     const intervalId = setInterval(() => {
//       if (!myEncryptionKeys) {
//         pollPlayers();
//       }
//     }, 3000);

//     // Cleanup interval on unmount
//     return () => clearInterval(intervalId);
//   }, [
//     game,
//     pokerService,
//     pushWalletSigner,
//     setGame,
//     setMyEncryptionKeys,
//     isPolling,
//     isTrying,
//   ]);
// }


import { useEffect, useState } from 'react';
import { generateKeyPair } from '../encryption';
import { usePokerGameContext } from './usePokerGameContext.tsx';
import usePushWalletSigner from './usePushSigner.tsx';

/**
 * Submit current player public key to the network so other players can use it to encrypt the deck.
 */
export default function useSubmitPlayerPublicKey() {
  const { game, myEncryptionKeys, setMyEncryptionKeys, pokerService } =
    usePokerGameContext();
  const { pushWalletSigner } = usePushWalletSigner();
  const [isTrying, setIsTrying] = useState(false); // Tracks if the process is ongoing
  const [isSubmitting, setIsSubmitting] = useState(false); // Tracks if submission is happening
  const [isSubmitted, setIsSubmitted] = useState(false); // Tracks if submission is complete

  useEffect(() => {
    if (!myEncryptionKeys && !isTrying && !isSubmitted && pokerService && game && pushWalletSigner) {
      const submitPublicKey = async () => {
        setIsTrying(true); // Mark the process as active
        setIsSubmitting(true); // Set submission status

        try {
          console.log("Submitting public key...");
          const keys = generateKeyPair();
          console.log("Generated keys:", keys.publicKey);
          console.log("Players:", [...game.players.keys()]);
          console.log("Push wallet signer:", pushWalletSigner);
          await pokerService.submitPublicKey(
            keys.publicKey,
            [...game.players.keys()],
            pushWalletSigner
          );
          setMyEncryptionKeys(keys); // Set encryption keys after successful submission
          setIsSubmitted(true); // Mark as submitted to prevent re-execution
          console.log("Public key submitted successfully.");
        } catch (error) {
          console.error("Error submitting public key:", error);
        } finally {
          setIsTrying(false); // Reset the process flag
          setIsSubmitting(false); // Clear submission status
        }
      };

      submitPublicKey();
    }
  }, [ isTrying, isSubmitted, pokerService, game, pushWalletSigner, setMyEncryptionKeys]);

  return { isSubmitting, isSubmitted }; // Return submission and submitted status
}
