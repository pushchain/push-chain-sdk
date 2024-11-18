import { PokerGame } from '../temp_types/types.ts';

export function usePlayerAddressUtils() {
  /**
   * 3 players playing: [0xA, 0xB, 0xC]
   * @example If Connected Player is 0xA. So we have to check if there is a transaction from 0xC
   * @example If Connected Player is 0xC. So we have to check if there is a transaction from 0xB
   * @param game
   * @param connectedPushAddressFormat
   */
  function getPreviousPlayerAddress(
    game: PokerGame,
    connectedPushAddressFormat: string
  ): string {
    const playersArray = Array.from(game.players.keys());
    const connectedUserIndex = playersArray.indexOf(connectedPushAddressFormat);
    let previousPlayerAddress: string;
    if (connectedUserIndex === 0) {
      previousPlayerAddress = playersArray[playersArray.length - 1];
    } else {
      previousPlayerAddress = playersArray[connectedUserIndex - 1];
    }
    return previousPlayerAddress;
  }

  /**
   * The public key we use to encrypt will be the **next** address from the dealer.
   * @example If players array = [0xA, 0xB, 0xC] and Dealer is 0xC, then we will use 0xA public key to encrypt
   * @example If players array = [0xA, 0xB, 0xC] and Dealer is 0xB, then we will use 0xC public key to encrypt
   * @param game
   * @param connectedPushAddressFormat
   */
  function getNextPlayerAddress(
    game: PokerGame,
    connectedPushAddressFormat: string
  ): string {
    // The order we encrypt is from the `game.players` starting from the Dealer.
    const playersArray = Array.from(game.players.keys());
    const connectedUserIndex = playersArray.indexOf(connectedPushAddressFormat);

    let nextPlayer: string;
    if (connectedUserIndex === playersArray.length - 1)
      nextPlayer = playersArray[0];
    else {
      nextPlayer = playersArray[connectedUserIndex + 1];
    }

    return nextPlayer;
  }

  return { getPreviousPlayerAddress, getNextPlayerAddress };
}
