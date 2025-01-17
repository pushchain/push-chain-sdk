/*
import { usePokerGameContext } from './usePokerGameContext.tsx';
import { useEffect, useState } from 'react';
import useConnectedPushAddress from './useConnectedPushAddress.tsx';
import { usePlayerAddressUtils } from './usePlayerAddressUtils.tsx';
import BN from 'bn.js';
import { commutativeDecrypt } from '../encryption';
import usePushWalletSigner from './usePushSigner.tsx';

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
      console.log("connectedPushAddressFormat, decrypt",connectedPushAddressFormat)
      console.log("hasFinishedEncryptingCards, decrypt",hasFinishedEncryptingCards)
      console.log("game, decrypt",game)
      console.log("pokerService, decrypt",pokerService)
      console.log("gameTransactionHash, decrypt",gameTransactionHash)
      console.log("myEncryptionKeys, decrypt",myEncryptionKeys)
      console.log("pushWalletSigner, decrypt",pushWalletSigner)
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
      console.log("previousAddress",previousAddress)
      if (previousAddress === game.dealer) {
        const decryptedCard = await pokerService.getDecryptedShuffledCards(
          gameTransactionHash,
          connectedPushAddressFormat
        );
        if (decryptedCard) return;
        console.log("decryptedCard, decrypt",decryptedCard);
        // Get deck from push chain
        const lastAddressToEncrypt = getPreviousPlayerAddress(
          game,
          game.dealer
        );
        const encryptedDeck = await pokerService.getEncryptedShuffledCards(
          gameTransactionHash,
          lastAddressToEncrypt
        );
        
        if (!encryptedDeck) {
          console.error("Failed to retrieve encrypted deck.");
          return};

        const nextAddress = getNextPlayerAddress(
          game,
          connectedPushAddressFormat
        );
        console.log("nextAddress, decrypt",nextAddress)
        console.log("encryptedDeck, decrypt",encryptedDeck)
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
          decryptedDeck,
          pushWalletSigner
        );
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [hasFinishedEncryptingCards, connectedPushAddressFormat]);
}
*/

import { usePokerGameContext } from './usePokerGameContext';
import { useEffect, useState, useRef } from 'react';
import useConnectedPushAddress from './useConnectedPushAddress';
import BN from 'bn.js';
import { commutativeDecrypt } from '../encryption';
import usePushWalletSigner from './usePushSigner';
import { Card, PokerGame, Rank, Suit } from '../temp_types/types';

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
    setGame
  } = usePokerGameContext();
  const { pushWalletSigner } = usePushWalletSigner();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const [hasDecrypted, setHasDecrypted] = useState(false);
  const processingRef = useRef(false);
  const maxCardRange = new BN(56);

  function numberToCard(cardNumber: number): Card {
    const suitValue = Math.floor(cardNumber / 14);
    const rankValue = cardNumber % 14;
    const rank = rankValue === 14 ? Rank.ACE : (rankValue - 2) as Rank;
    const suitMap = [Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS, Suit.SPADES];
    const suit = suitMap[suitValue];
    return { rank, suit };
  }

  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout;
    
    const decryptCards = async () => {
      if (!game || !pokerService || !gameTransactionHash || !myEncryptionKeys || 
          !pushWalletSigner || !connectedPushAddressFormat || hasDecrypted || 
          !hasFinishedEncryptingCards || game.phase !== 'DECRYPTING' || 
          processingRef.current) {
        return;
      }

      try {
        processingRef.current = true;
        const playersArr = Array.from(game.players.keys());
        const currentTurnIndex = game.turnIndex ?? 0;
        const currentPlayer = playersArr[currentTurnIndex];

        console.log('[Decryption] State check:', {
          currentTurnIndex,
          currentPlayer,
          myAddress: connectedPushAddressFormat,
          phase: game.phase,
          hasDecrypted,
          isProcessing: processingRef.current
        });

        if (currentPlayer !== connectedPushAddressFormat) {
          processingRef.current = false;
          return;
        }

        // Get existing transaction to prevent duplicates
        const existingDecryption = await pokerService.getDecryptedShuffledCards(
          gameTransactionHash,
          connectedPushAddressFormat
        );

        if (existingDecryption) {
          console.log('[Decryption] Already processed this turn');
          setHasDecrypted(true);
          processingRef.current = false;
          return;
        }

        const updatedGame = { ...game };
        
        // Process hole cards
        if (game.playerHoleCards?.[connectedPushAddressFormat]) {
          console.log('[Decryption] Processing hole cards');
          const myHoleCards = game.playerHoleCards[connectedPushAddressFormat]
            .map(cardStr => new BN(cardStr, 10))
            .map(cardBN => {
              const decrypted = commutativeDecrypt(
                cardBN,
                otherPlayersPublicKey.get(connectedPushAddressFormat)!,
                myEncryptionKeys.privateKey
              );
              return numberToCard(decrypted.umod(maxCardRange).toNumber());
            });

          const playerData = updatedGame.players.get(connectedPushAddressFormat);
          if (playerData) {
            playerData.cards = myHoleCards;
            updatedGame.players.set(connectedPushAddressFormat, playerData);
          }
        }

        // Process community cards
        if (game.communityCardsEncrypted?.length) {
          console.log('[Decryption] Processing community cards');
          const nextPlayerIndex = (currentTurnIndex + 1) % playersArr.length;
          const nextPlayer = playersArr[nextPlayerIndex];
          
          const decryptedCommunity = game.communityCardsEncrypted
            .map(cardStr => new BN(cardStr, 10))
            .map(cardBN => {
              const decrypted = commutativeDecrypt(
                cardBN,
                otherPlayersPublicKey.get(nextPlayer)!,
                myEncryptionKeys.privateKey
              );
              return decrypted.toString(10);
            });

          if (currentTurnIndex === playersArr.length - 1) {
            const finalCards = decryptedCommunity
              .map(cardStr => new BN(cardStr, 10))
              .map(cardBN => numberToCard(cardBN.umod(maxCardRange).toNumber()));
            
            updatedGame.cards = finalCards;
            updatedGame.communityCardsEncrypted = [];
            updatedGame.phase = 'READY';
          } else {
            updatedGame.communityCardsEncrypted = decryptedCommunity;
          }
        }

        updatedGame.turnIndex = currentTurnIndex + 1;

        if (!updatedGame.phases) {
          updatedGame.phases = new Map();
          updatedGame.phases.set(0, { bets: new Map() });
        }

        console.log('[Decryption] Publishing update:', {
          turnIndex: updatedGame.turnIndex,
          phase: updatedGame.phase
        });

        await pokerService.publishPartialDecryption(
          gameTransactionHash,
          updatedGame,
          pushWalletSigner
        );

        if (mounted) {
          setGame(updatedGame);
          setHasDecrypted(true);
        }

      } catch (error) {
        console.error('[Decryption] Error:', error);
      } finally {
        processingRef.current = false;
      }
    };

    timeoutId = setTimeout(decryptCards, 3000);

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [
    game,
    pokerService,
    gameTransactionHash,
    myEncryptionKeys,
    pushWalletSigner,
    connectedPushAddressFormat,
    hasDecrypted,
    hasFinishedEncryptingCards,
    otherPlayersPublicKey
  ]);

  return { hasDecrypted };
}``