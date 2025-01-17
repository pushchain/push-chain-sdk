import { useEffect, useState } from 'react';
import { usePokerGameContext } from './usePokerGameContext.tsx';
import usePushWalletSigner from './usePushSigner.tsx';
import useConnectedPushAddress from './useConnectedPushAddress.tsx';
import BN from 'bn.js';
import { deckOfCards, shuffleCards } from '../lib/cards.ts';
import { commutativeEncrypt } from '../encryption';
import { curve } from 'elliptic';
import BasePoint = curve.base.BasePoint;
import { usePlayerAddressUtils } from './usePlayerAddressUtils.tsx';


/**
 * This hook is responsible for the initial card dealing algorithm.
 * The first player responsible for dealing the cards is the dealer. Then we encrypt following the
 * order of player from the player's array until the last player encrypts and shuffles the deck of cards.
 */
export default function useSubmitEncryptedShuffledCards() {
  const [hasFinishedEncryptingCards, setHasFinishedEncryptingCards] =
    useState(false);
  const {
    game,
    myEncryptionKeys,
    otherPlayersPublicKey,
    pokerService,
    gameTransactionHash,
  } = usePokerGameContext();
  const { pushWalletSigner } = usePushWalletSigner();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const { getNextPlayerAddress } = usePlayerAddressUtils();
  const [shuffleDeckInitiated, setshuffleDeckInitiated] = useState(false);

  type Card = string;

  const cardToNumber = (card: Card): number => {
    // Define mappings for rank and suit
    const rankOrder: Record<string, number> = {
      "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
      "J": 11, "Q": 12, "K": 13, "A": 14
    };
    const suitOrder: Record<string, number> = {
      "C": 0, "D": 1, "H": 2, "S": 3
    };
  
    // Extract rank and suit
    const rank = card.slice(0, -1); // Extract rank (e.g., "9" from "9C")
    const suit = card.slice(-1);   // Extract suit (e.g., "C" from "9C")
  
    // Combine rank and suit into a unique number
    if (rankOrder[rank] !== undefined && suitOrder[suit] !== undefined) {
      return rankOrder[rank] + suitOrder[suit] * 14; // Example: "9C" -> 9, "AH" -> 42
    } else {
      throw new Error(`Invalid card: ${card}`);
    }
  };

  /**
   * Function called only once when starting the deck shuffling. Function can only
   * be called by **game creator**
   * @param publicKey - Next player's public key in the array of player's order
   * @param privateKey - Connected user private key
   */
  function beginShuffleDeck(publicKey: BasePoint, privateKey: BN): Set<BN> {
    const cards = deckOfCards();
    
    const shuffledCards = shuffleCards(cards);
    // const shuffledCards = [10,12]
    const encryptedShuffledCards = new Set<BN>();
    // console.log("shuffledCards",shuffledCards)
    // console.log("encryptedShuffledCards",encryptedShuffledCards)
    shuffledCards.forEach((card) => {
      // console.log("card",card)
      const cardNumber = cardToNumber(card)
      const message = new BN(cardNumber);
      // console.log("message",card ,message)
      // TODO: Add proof
      const encryptedCard = commutativeEncrypt(message, publicKey, privateKey);
      // console.log("encryptedCard",encryptedCard)
      encryptedShuffledCards.add(encryptedCard);
    });
    return encryptedShuffledCards;
  }

  function shuffleDeck(
    publicKey: BasePoint,
    privateKey: BN,
    cards: Set<BN>
  ): Set<BN> {
    const shuffledCards = shuffleCards(cards);
    const encryptedShuffledCards = new Set<BN>();
    shuffledCards.forEach((card) => {
      const encryptedCard = commutativeEncrypt(card, publicKey, privateKey);
      encryptedShuffledCards.add(encryptedCard);
    });
    return encryptedShuffledCards;
  }

  useEffect(() => {
    if (!game || !pokerService || !gameTransactionHash) return;
    const intervalId = setInterval(async () => {
      try {
        // console.log("game",game)
        // console.log("pushWalletSigner",pushWalletSigner)
        // console.log("pokerService",pokerService)
        // console.log("gameTransactionHash",gameTransactionHash)
        // console.log("connectedPushAddressFormat",connectedPushAddressFormat)
        if (
          !game ||
          !pushWalletSigner ||
          !pokerService ||
          !gameTransactionHash ||
          !connectedPushAddressFormat
        )
          return;
        // We can only start dealing the cards once all public keys have been given, and we have generated
        // our own encryption keys
        console.log("otherPlayersPublicKey.size",otherPlayersPublicKey.size)
        console.log("game.players.size",game.players.size)
        console.log("myEncryptionKeys",myEncryptionKeys)
        if (
          otherPlayersPublicKey.size !== game.players.size ||
          !myEncryptionKeys
        ) {
          return;
        }

        if (hasFinishedEncryptingCards) return;

        // Only Dealer can **start** shuffling the deck
        if (connectedPushAddressFormat == game.dealer ) {
          console.log("lets Shuffle",shuffleDeckInitiated)
          if(!shuffleDeckInitiated){
            console.log("shuffleDeckInitiated",shuffleDeckInitiated)
          const playerAfterDealer = getNextPlayerAddress(
            game,
            connectedPushAddressFormat
          );
          console.log("nextPlayerAddress",playerAfterDealer)

          const publicKeyPlayerAfterDealer =
            otherPlayersPublicKey.get(playerAfterDealer);
      
          if (!publicKeyPlayerAfterDealer) return;
          console.log("playerAfterDealer",playerAfterDealer)
          console.log("publicKeyPlayerAfterDealer",publicKeyPlayerAfterDealer)
          console.log("myEncryptionKeys.privateKey",myEncryptionKeys.privateKey)
          const encryptedShuffleDeck = beginShuffleDeck(
            publicKeyPlayerAfterDealer,
            myEncryptionKeys.privateKey
          );
          console.log("encryptedShuffleDeck",encryptedShuffleDeck)

          await pokerService.publishEncryptedShuffledCards(
            gameTransactionHash,
            game.creator,
            encryptedShuffleDeck,
            pushWalletSigner
          );
          setshuffleDeckInitiated(true);

        }
        } else {
          if(!shuffleDeckInitiated){
          // Check if it's our turn to shuffle the deck.
          // How do we do that?
          // We go over the player's array in order, and check if there is a transaction for the address
          // right before our connected address. If there isn't, then mean it's not our turn yet to shuffle
          // the deck. If there is, then it's our turn.

          const playersArray = Array.from(game.players.keys());
          const connectedUserIndex = playersArray.indexOf(
            connectedPushAddressFormat
          );

          // 3 players playing: [0xA, 0xB, 0xC]
          // If Connected Player is 0xA. So we have to check if there is a transaction from 0xC
          // If Connected Player is 0xC. So we have to check if there is a transaction from 0xB
          let previousPlayerAddress: string;
          if (connectedUserIndex === 0) {
            previousPlayerAddress = playersArray[playersArray.length - 1];
          } else {
            previousPlayerAddress = playersArray[connectedUserIndex - 1];
          }

          const encryptedDeckFromPreviousPlayer =
            await pokerService.getEncryptedShuffledCards(
              gameTransactionHash,
              previousPlayerAddress
            );
            console.log("encryptedDeckFromPreviousPlayer", encryptedDeckFromPreviousPlayer)
          if (!encryptedDeckFromPreviousPlayer) return; // No transaction from previous player yet, we just have to wait

          // Get next player public key
          const nextPlayerAddress = getNextPlayerAddress(
            game,
            connectedPushAddressFormat
          );
          const publicKeyNextPlayer =
            otherPlayersPublicKey.get(nextPlayerAddress);
          if (!publicKeyNextPlayer) return;

          // Shuffle and encrypt
          const shuffledCards = shuffleDeck(
            publicKeyNextPlayer,
            myEncryptionKeys.privateKey,
            encryptedDeckFromPreviousPlayer
          );
          // Publish new deck
          setshuffleDeckInitiated(true);

          await pokerService.publishEncryptedShuffledCards(
            gameTransactionHash,
            game.creator,
            shuffledCards,
            pushWalletSigner
          );
        }
        }
      } catch (e) {
        console.log(e);
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [game, pokerService]);

  useEffect(() => {
    if (pokerService && gameTransactionHash && game) {
      const intervalId = setInterval(async () => {
        console.log("getting encrypted shuffled cards")
        let lastAddressToEncrypt: string;
        // Check dealer position. If dealer is index 0 of array, then last player to encrypt is players.length-1
        // If dealer is any other index, then last player to encrypt is index-1
        const playersAddress = Array.from(game.players.keys());
        const indexOfDealer = playersAddress.indexOf(game.dealer);
        if (indexOfDealer === 0) {
          lastAddressToEncrypt = playersAddress[playersAddress.length - 1];
        } else {
          lastAddressToEncrypt = playersAddress[indexOfDealer - 1];
        }
        console.log("lastAddressToEncrypt",lastAddressToEncrypt)
        console.log("gameTransactionHash1",gameTransactionHash)
        const cards = await pokerService.getEncryptedShuffledCards(
          gameTransactionHash,
          lastAddressToEncrypt
        );
        console.log("cards",cards)
        if (cards) {
          console.log("cards1",cards)
          setHasFinishedEncryptingCards(true);
          console.log("hasFinishedEncryptingCards",hasFinishedEncryptingCards)
        }
        console.log("hasFinishedEncryptingCards1",hasFinishedEncryptingCards)
      }, 2000);

      return () => clearInterval(intervalId);
    }
  }, [pokerService, gameTransactionHash, game]);

  return { hasFinishedEncryptingCards };
}
