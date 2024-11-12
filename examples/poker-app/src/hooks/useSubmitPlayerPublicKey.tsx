import { useEffect } from 'react';
import { generateKeyPair } from '../encryption';
import { usePokerGameContext } from './usePokerGameContext.tsx';
import usePushWalletSigner from './usePushSigner.tsx';

/**
 * Submit current player public key to the network so other players can use it to encrypt the deck
 */
export default function useSubmitPlayerPublicKey() {
  const { game, myEncryptionKeys, setMyEncryptionKeys, pokerService } =
    usePokerGameContext();
  const { pushWalletSigner } = usePushWalletSigner();

  useEffect(() => {
    (async () => {
      if (!myEncryptionKeys || !pokerService || !game || !pushWalletSigner)
        return;
      const keys = generateKeyPair();
      await pokerService.submitPublicKey(
        keys.publicKey,
        [...game.players.keys()],
        pushWalletSigner
      );
      setMyEncryptionKeys(keys);
    })();
  }, [
    myEncryptionKeys,
    pokerService,
    game,
    pushWalletSigner,
    setMyEncryptionKeys,
  ]);
}
