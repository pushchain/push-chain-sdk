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

import { usePokerGameContext } from './usePokerGameContext.tsx';
import { useEffect, useState } from 'react';
import useConnectedPushAddress from './useConnectedPushAddress.tsx';
import { usePlayerAddressUtils } from './usePlayerAddressUtils.tsx';
import BN from 'bn.js';
import { commutativeDecrypt } from '../encryption';
import usePushWalletSigner from './usePushSigner.tsx';
import { Card, PokerGame, Rank, Suit } from '../temp_types/types'; // Ensure correct path

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
  const { getPreviousPlayerAddress, getNextPlayerAddress } = usePlayerAddressUtils();
  const [hasDecrypted, setHasDecrypted] = useState(false);

  const maxCardRange = new BN(56); // Safe upper bound for card numbering (52 cards + some buffer)

  function numberToCard(cardNumber: number): Card {
    let rankValue = cardNumber % 14;
    if (rankValue === 0) rankValue = 14; // Ace
    const suitValue = Math.floor(cardNumber / 14);

    const rankOrder: Rank[] = [
      Rank.ACE, Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX,
      Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING
    ];

    const rankIndex = (rankValue === 14) ? 0 : (rankValue - 1);
    const rank = rankOrder[rankIndex];

    // suitValue: 0 -> Clubs, 1 -> Diamonds, 2 -> Hearts, 3 -> Spades
    // Suit enum: SPADES=0, HEARTS=1, DIAMONDS=2, CLUBS=3
    // Original map was C=0,D=1,H=2,S=3, we need to invert this mapping if necessary
    // Here, we used suitMap = [CLUBS(3), DIAMONDS(2), HEARTS(1), SPADES(0)]
    // If your encryption assumed C=0,D=1,H=2,S=3, this array indexes suits by that order:
    const suitMap: Suit[] = [Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS, Suit.SPADES];
    const suit = suitMap[suitValue];

    return { rank, suit };
  }

  useEffect(() => {
    const intervalId = setInterval(async () => {
      console.log("Decrypt Hook Conditions:", {
        connectedPushAddressFormat,
        hasFinishedEncryptingCards,
        game: !!game,
        pokerService: !!pokerService,
        gameTransactionHash,
        myEncryptionKeys: !!myEncryptionKeys,
        pushWalletSigner: !!pushWalletSigner
      });
      if (
        !connectedPushAddressFormat ||
        !hasFinishedEncryptingCards ||
        !game ||
        !pokerService ||
        !gameTransactionHash ||
        !myEncryptionKeys ||
        !pushWalletSigner
      ) return;

      if (game.phase !== 'DECRYPTING') return;
      if (hasDecrypted) return;

      const playersArr = Array.from(game.players.keys());
      const currentTurnIndex = game.turnIndex ?? 0;
      if (currentTurnIndex >= playersArr.length) return; // already done

      const currentPlayer = playersArr[currentTurnIndex];

      console.log("[useDecryptPlayersCards]: Player", connectedPushAddressFormat, "TurnIndex:", currentTurnIndex, "CurrentPlayer:", currentPlayer, "Phase:", game.phase);

      if (currentPlayer !== connectedPushAddressFormat) {
        // Not our turn yet
        return;
      }

      console.log("[useDecryptPlayersCards]: It's my turn to decrypt. Decrypting hole cards...");

      // Decrypt hole cards
      const encryptedHoleCardsStr = game.playerHoleCards?.[connectedPushAddressFormat] || [];
      const encryptedHoleBN = encryptedHoleCardsStr.map(s => new BN(s, 10));

      const myPubKey = otherPlayersPublicKey.get(connectedPushAddressFormat)!;
      const decryptedHoleBN = encryptedHoleBN.map(cardBN => commutativeDecrypt(cardBN, myPubKey, myEncryptionKeys.privateKey));

      // Reduce each hole card BN modulo 56 before calling toNumber()
      const decryptedHoleCardsObj = decryptedHoleBN.map(bn => {
        const reducedBN = bn.umod(maxCardRange);
        return numberToCard(reducedBN.toNumber());
      });

      const updatedGameLocal = { ...game };
      const playerData = updatedGameLocal.players.get(connectedPushAddressFormat);
      if (playerData) {
        playerData.cards = decryptedHoleCardsObj; 
      }

      setGame(updatedGameLocal);

      console.log("[useDecryptPlayersCards]: Hole cards decrypted:", decryptedHoleCardsObj);

      // Decrypt community cards
      const encryptedCommunityStr = game.communityCardsEncrypted || [];
      const encryptedCommunityBN = encryptedCommunityStr.map(s => new BN(s, 10));

      const nextPlayerAddress = (() => {
        const idx = playersArr.indexOf(connectedPushAddressFormat);
        return idx === playersArr.length - 1 ? playersArr[0] : playersArr[idx + 1];
      })();

      const nextPubKey = otherPlayersPublicKey.get(nextPlayerAddress)!;
      const partiallyDecryptedCommunity = encryptedCommunityBN.map(c =>
        commutativeDecrypt(c, nextPubKey, myEncryptionKeys.privateKey)
      );

      const newTurnIndex = currentTurnIndex + 1;
      let finalGameUpdate;

      if (newTurnIndex >= playersArr.length) {
        // Last player - fully reveal community cards
        // Now reduce and convert each community card as well
        const revealedCommunity = partiallyDecryptedCommunity.map(c => {
          const reducedBN = c.umod(maxCardRange);
          return numberToCard(reducedBN.toNumber());
        });

        finalGameUpdate = {
          ...game,
          cards: revealedCommunity, 
          communityCardsEncrypted: [],
          turnIndex: newTurnIndex,
          phase: 'READY'
        };
      } else {
        // Not last player yet
        // Just store the partially decrypted community as strings
        const partiallyDecryptedCommunityStr = partiallyDecryptedCommunity.map(c => c.toString(10));
        finalGameUpdate = {
          ...game,
          communityCardsEncrypted: partiallyDecryptedCommunityStr,
          turnIndex: newTurnIndex
        };
      }

      await pokerService.updateGame(
        gameTransactionHash,
        finalGameUpdate as PokerGame,
        new Set(playersArr),
        pushWalletSigner
      );

      setGame(finalGameUpdate as PokerGame);
      setHasDecrypted(true);
    }, 3000);

    return () => clearInterval(intervalId);
  }, [
    hasFinishedEncryptingCards,
    connectedPushAddressFormat,
    game,
    pokerService,
    gameTransactionHash,
    myEncryptionKeys,
    otherPlayersPublicKey,
    pushWalletSigner,
    setGame,
    hasDecrypted
  ]);

  return null;
}
