import ConfettiExplosion from 'react-confetti-explosion';
import {
  cardBackImageURL,
  cardImageURL,
  deckOfCards,
  shuffleCards,
} from '../lib/cards';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { usePokerGameContext } from '../hooks/usePokerGameContext.tsx';
import usePushWalletSigner from '../hooks/usePushSigner.tsx';
import useConnectedPushAddress from '../hooks/useConnectedPushAddress.tsx';
import useFetchPlayersPublicKeys from '../hooks/useFetchPlayersPublicKeys.tsx';
import useSubmitPlayerPublicKey from '../hooks/useSubmitPlayerPublicKey.tsx';
import { PokerGame } from '../temp_types/types.ts';
import { curve } from 'elliptic';
import BasePoint = curve.base.BasePoint;
import BN from 'bn.js';
import { commutativeEncrypt } from '../encryption';

export default function Game() {
  const { user } = usePrivy();
  const {
    game,
    myEncryptionKeys,
    otherPlayersPublicKey,
    pokerService,
    gameTransactionHash,
  } = usePokerGameContext();
  const { pushWalletSigner } = usePushWalletSigner();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const [hasDealtCards, setHasDealtCards] = useState(false);

  // Custom hook to submit current player public key to the network so other players can use it to encrypt the deck
  useSubmitPlayerPublicKey();

  // Fetch other players public keys
  useFetchPlayersPublicKeys();

  function getNextPlayerAddress(
    game: PokerGame,
    connectedPushAddressFormat: string
  ): string {
    // The order we encrypt is from the `game.players` starting from the Dealer.
    const playersArray = Array.from(game.players.keys());
    const connectedUserIndex = playersArray.indexOf(connectedPushAddressFormat);

    // The public key we use to encrypt will be the **next** address from the dealer.
    // Example1: players array = [0xA, 0xB, 0xC] and Dealer is 0xC, then we will use 0xA public key to encrypt
    // Example2: players array = [0xA, 0xB, 0xC] and Dealer is 0xB, then we will use 0xC public key to encrypt
    let nextPlayer: string;
    if (connectedUserIndex === playersArray.length - 1)
      nextPlayer = playersArray[0];
    else {
      nextPlayer = playersArray[connectedUserIndex + 1];
    }

    return nextPlayer;
  }

  /**
   * Function called only once when starting the deck shuffling. Function can only
   * be called by **game creator**
   * @param publicKey - Next player's public key in the array of player's order
   * @param privateKey - Connected user private key
   */
  function beginShuffleDeck(publicKey: BasePoint, privateKey: BN): Set<BN> {
    const cards = deckOfCards();
    const shuffledCards = shuffleCards(cards);
    const encryptedShuffledCards = new Set<BN>();
    shuffledCards.forEach((card) => {
      const message = new BN(card);
      const encryptedCard = commutativeEncrypt(message, publicKey, privateKey);
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

  // Dealing cards
  useEffect(() => {
    (async function () {
      try {
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
        if (
          otherPlayersPublicKey.size + 1 !== game.players.size ||
          !myEncryptionKeys
        ) {
          return;
        }

        if (hasDealtCards) return;

        // Only Dealer can **start** shuffling the deck
        if (connectedPushAddressFormat == game.dealer) {
          const playerAfterDealer = getNextPlayerAddress(
            game,
            connectedPushAddressFormat
          );
          const publicKeyPlayerAfterDealer =
            otherPlayersPublicKey.get(playerAfterDealer);
          if (!publicKeyPlayerAfterDealer) return;
          const encryptedShuffleDeck = beginShuffleDeck(
            publicKeyPlayerAfterDealer,
            myEncryptionKeys.privateKey
          );
          await pokerService.publishEncryptedShuffledCards(
            gameTransactionHash,
            game.creator,
            encryptedShuffleDeck,
            pushWalletSigner
          );
        } else {
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
            await pokerService.getLatestEncryptedShuffledCards(
              gameTransactionHash,
              previousPlayerAddress
            );
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
          await pokerService.publishEncryptedShuffledCards(
            gameTransactionHash,
            game.creator,
            shuffledCards,
            pushWalletSigner
          );
          // Check if all players have already encrypted, if yes, then set property hasDealtCards to true
          // We can check this by seeing if next player is the Dealer, if yes, then we are the last player to encrypt.
          if (nextPlayerAddress === game.dealer) setHasDealtCards(true);
        }
      } catch (e) {
        console.log(e);
      }
    })();
  }, [user, game, otherPlayersPublicKey]);

  return (
    <div className="flex flex-col h-full w-full items-end">
      <ConfettiExplosion
        force={0.8}
        duration={4000}
        particleCount={400}
        width={window.innerWidth}
        height={window.innerHeight}
      />
      <OpponentHand position="top" />
      <div className="flex flex-row w-full">
        <OpponentHand position="left" />
        <Board />
        <OpponentHand position="right" />
      </div>
      <MyHand />
    </div>
  );
}

function Board() {
  return (
    <div className="flex flex-row items-center w-full gap-0 mt-40 justify-center">
      <img className="w-12" src={cardBackImageURL()} alt={'card'} />
      <img className="w-12" src={cardBackImageURL()} alt={'card'} />
      <img className="w-12" src={cardBackImageURL()} alt={'card'} />
      <img className="w-12" src={cardBackImageURL()} alt={'card'} />
      <img className="w-12" src={cardBackImageURL()} alt={'card'} />
    </div>
  );
}

function MyHand() {
  return (
    <div className="flex flex-col items-center w-full gap-0 mt-40">
      <Chips />
      <div className="flex flex-row justify-center items-center w-full">
        <img
          className="w-36"
          src={cardImageURL({ suit: 'H', rank: '6' })}
          alt={'card'}
        />
        <img
          className="w-36"
          src={cardImageURL({ suit: 'C', rank: 'K' })}
          alt={'card'}
        />
      </div>
      <input
        type="number"
        step="1"
        min="1"
        max="100"
        className="border border-gray-300 rounded-lg p-3 text-center w-1/3 shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ease-in-out"
        placeholder="Place your bet"
      />
      <button className="bg-blue-500 text-white px-4 py-2 rounded-lg shadow-md mt-4">
        Bet
      </button>
    </div>
  );
}

function OpponentHand({ position }: { position: 'left' | 'right' | 'top' }) {
  const positionClass =
    position === 'left'
      ? 'justify-start'
      : position === 'right'
      ? 'justify-end'
      : 'justify-center';

  return (
    <div className="flex flex-col items-center w-full gap-0">
      <div className={`flex flex-row items-center w-full ${positionClass}`}>
        {position === 'right' && <Chips />}
        <img className="w-12" src={cardBackImageURL()} alt={'card'} />
        <img className="w-12" src={cardBackImageURL()} alt={'card'} />
        {position === 'left' && <Chips />}
      </div>
      {position === 'top' && <Chips />}
    </div>
  );
}

const Chips = () => {
  return (
    <img
      className="w-12"
      src={
        'https://i.pinimg.com/originals/64/36/44/643644be80473b0570920700e80fd36f.png'
      }
      alt={'chips'}
    />
  );
};
