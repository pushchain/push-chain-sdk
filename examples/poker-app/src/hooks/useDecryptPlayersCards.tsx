import { usePokerGameContext } from './usePokerGameContext.tsx';
import { useEffect, useState } from 'react';
import useConnectedPushAddress from './useConnectedPushAddress.tsx';
import { usePlayerAddressUtils } from './usePlayerAddressUtils.tsx';
import BN from 'bn.js';
import { commutativeDecrypt } from '../encryption';
import usePushWalletSigner from './usePushSigner.tsx';

/**
 * This hook is the 2nd half of the dealing cards algorithm and can only start after the 1st part has finished.
 * The first part is the hook `useSubmitEncryptedShuffledCards`.
 * We start dealing the cards following the game players order starting by the dealer.
 */
export default function useDecryptPlayersCards({
  hasFinishedEncryptingCards,
}: {
  hasFinishedEncryptingCards: boolean;
}) {
  const {
    game,
    myEncryptionKeys,
    otherPlayersPublicKey,
    pokerService,
    gameTransactionHash,
  } = usePokerGameContext();
  const { pushWalletSigner } = usePushWalletSigner();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const [cards, setCards] = useState<Set<string> | null>(null);
  const { getPreviousPlayerAddress, getNextPlayerAddress } =
    usePlayerAddressUtils();

  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (
        !connectedPushAddressFormat ||
        !hasFinishedEncryptingCards ||
        !game ||
        !pokerService ||
        !gameTransactionHash ||
        !myEncryptionKeys ||
        !pushWalletSigner
      )
        return;
      // Check if I'm the player right next to the dealer
      // If yes and I haven't submitted a decryption yet, then do it, else do nothing
      const previousAddress = getPreviousPlayerAddress(
        game,
        connectedPushAddressFormat
      );
      if (previousAddress === game.dealer) {
        const decryptedCard = await pokerService.getDecryptedShuffledCards(
          gameTransactionHash,
          connectedPushAddressFormat
        );
        if (decryptedCard) return;
        // Get deck from push chain
        const lastAddressToEncrypt = getPreviousPlayerAddress(
          game,
          game.dealer
        );
        const encryptedDeck = await pokerService.getEncryptedShuffledCards(
          gameTransactionHash,
          lastAddressToEncrypt
        );
        if (!encryptedDeck) return;

        const nextAddress = getNextPlayerAddress(
          game,
          connectedPushAddressFormat
        );
        if (!nextAddress) return;

        const decryptedDeck = new Set<BN>();
        encryptedDeck.forEach((card) => {
          decryptedDeck.add(
            commutativeDecrypt(
              card,
              otherPlayersPublicKey.get(nextAddress)!,
              myEncryptionKeys?.privateKey
            )
          );
        });

        await pokerService.publishDecryptedShuffledCards(
          gameTransactionHash,
          game.creator,
          decryptedCard,
          pushWalletSigner
        );
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [hasFinishedEncryptingCards, connectedPushAddressFormat]);
}
