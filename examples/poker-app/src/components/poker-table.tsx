import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
// import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Clock, Users, Shield } from 'lucide-react';
import { cn } from "../lib/utils";
import { usePokerGameContext } from "../hooks/usePokerGameContext";
import { cardImageURL, cardBackImageURL } from "../lib/cards";
import useConnectedPushAddress from "../hooks/useConnectedPushAddress";
import usePushWalletSigner from '../hooks/usePushSigner';
import { generateKeyPair } from '../encryption';
import { Button } from './ui/button';

interface Player {
  id: string;
  name: string;
  chips: number;
  cards?: string[];
  position?: string;
  isDealer?: boolean;
}

interface PokerTableProps {
  dealingPhase: 'WAITING_FOR_PLAYERS' | 'KEY_EXCHANGE' | 'ENCRYPTING' | 'DECRYPTING' | 'READY';
  isDealer: boolean;
}

// Helper function for player positioning based on number of players
const getPlayerPosition = (index: number, totalPlayers: number) => {
  // For 3 players - triangular setup
  if (totalPlayers === 3) {
    const positions = ['bottom', 'top-right', 'top-left'];
    return positions[index % positions.length];
  }
  
  // For 4 players - square setup
  if (totalPlayers === 4) {
    const positions = ['bottom', 'right', 'top', 'left'];
    return positions[index % positions.length];
  }
  
  // For 5-6 players - hexagonal setup
  const positions = ['bottom', 'right', 'top-right', 'top', 'top-left', 'left'];
  return positions[index % positions.length];
};

export default function PokerTable({ dealingPhase, isDealer }: PokerTableProps) {
  const { game,pokerService,gameTransactionHash ,setGame} = usePokerGameContext();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const [communityCards, setCommunityCards] = useState<string[]>([]);
  const [showCards, setShowCards] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const { pushWalletSigner } = usePushWalletSigner(); 


  // useEffect(() => {
  //   if (!game || !pokerService || !gameTransactionHash) {
  //     console.log("Missing dependencies for polling: game, pokerService, or gameTransactionHash");
  //     return;
  //   }

  //   const pollPlayers = async () => {
  //     try {
  //       const updatedPlayers = await pokerService.getPlayerOrderForTable({
  //         txHash: gameTransactionHash,
  //         creator: game.creator,
  //       });

  //       if (updatedPlayers) {
  //         // Clone current game state
  //         const updatedGame = { ...game };

  //         // Update players in the cloned game state
  //         updatedGame.players = new Map(game.players); // Ensure a new map is used
  //         updatedPlayers.forEach((playerAddress) => {
  //           if (!updatedGame.players.has(playerAddress)) {
  //             updatedGame.players.set(playerAddress, {
  //               chips: 100,
  //               cards: [],
  //             });
  //           }
  //         });

  //         // Update the game state using setGame
  //         setGame(updatedGame);
  //       }
  //     } catch (error) {
  //       console.error("Error fetching player order:", error);
  //     }
  //   };

  //   // Set an interval to poll every 3 seconds
  //   const intervalId = setInterval(() => {
  //     pollPlayers();
  //   }, 5000);

  //   // Cleanup interval on component unmount
  //   return () => clearInterval(intervalId);
  // }, [game, pokerService, gameTransactionHash, setGame]);

  const handleEncryption = async () => {
    if (!pokerService || !game || !pushWalletSigner) {
      console.error('Missing pokerService, game, or wallet signer');
      return;
    }

    try {
      const keys = generateKeyPair(); // Generate encryption keys
      await pokerService.submitPublicKey(
        gameTransactionHash,
        keys.publicKey,
        [...game.players.keys()], // Pass player addresses
        pushWalletSigner
      );
      console.log('Public key successfully submitted');
    } catch (error) {
      console.error('Error submitting public key:', error);
    }
  };

  // Memoized players array
  const players = useMemo(() => {
    
    if (!game) return [];
    
    return Array.from(game.players.entries()).map(([address, player], index) => ({
      id: address,
      name: `Player ${index + 1}${address === connectedPushAddressFormat ? ' (You)' : ''}`,
      chips: player.chips,
      cards: player.cards,
      position: getPlayerPosition(index, game.players.size),
      isDealer: address === game.dealer
    }));
  }, [game, connectedPushAddressFormat]);

  // Session timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSessionTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Card visibility management
  useEffect(() => {
    if (dealingPhase === 'READY') {
      setShowCards(true);
    } else {
      setShowCards(false);
    }
  }, [dealingPhase]);

  // Update community cards when game state changes
  useEffect(() => {
    if (game) {
      setCommunityCards(game.cards || []);
    }
  }, [game]);

  const formatSessionTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const renderPlayerCards = (player: Player) => (
    <AnimatePresence>
      {player.cards && (
        <motion.div 
          className="flex gap-1 mt-4"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
        >
          {player.cards.map((card, index) => (
            <motion.div
              key={index}
              className="w-12 h-16 bg-white rounded-lg flex items-center justify-center shadow-lg overflow-hidden"
              initial={{ rotateY: 180 }}
              animate={{ 
                rotateY: showCards && player.id === connectedPushAddressFormat ? 0 : 180 
              }}
              transition={{ 
                duration: 0.5, 
                delay: index * 0.2 
              }}
            >
              <img 
                src={player.id === connectedPushAddressFormat && showCards 
                  ? cardImageURL({ 
                      suit: card.slice(-1) as 'S' | 'H' | 'D' | 'C',
                      rank: card.slice(0, -1) as 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2'
                    }) 
                  : cardBackImageURL()} 
                alt={player.id === connectedPushAddressFormat && showCards 
                  ? card 
                  : 'Card back'} 
                className="w-full h-full object-contain"
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  const renderCommunityCards = () => (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2 mt-12">
      <AnimatePresence>
        {communityCards.map((card, index) => (
          <motion.div
            key={index}
            className="w-14 h-20 bg-white rounded-lg flex items-center justify-center shadow-lg"
            initial={{ scale: 0, rotateY: 180 }}
            animate={{ 
              scale: 1, 
              rotateY: dealingPhase === 'READY' ? 0 : 180 
            }}
            transition={{ 
              duration: 0.5, 
              delay: index * 0.2 + 0.5 
            }}
          >
            <img 
              src={dealingPhase === 'READY' 
                ? cardImageURL({ 
                    suit: card.slice(-1) as 'S' | 'H' | 'D' | 'C',
                    rank: card.slice(0, -1) as 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2'
                  }) 
                : cardBackImageURL()} 
              alt={dealingPhase === 'READY' ? card : 'Card back'} 
              className="w-full h-full object-contain" 
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );

  const renderPhaseOverlay = () => {
    switch (dealingPhase) {
      case 'WAITING_FOR_PLAYERS':
        return (
          <motion.div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Card className="bg-black/80 border-white/20">
              <div className="p-6 text-center text-white">
                <Users className="w-12 h-12 mb-4 mx-auto text-yellow-500" />
                <h3 className="text-xl font-bold mb-2">Waiting for Players</h3>
                <p className="text-white/70 mb-2">Need minimum 3 players to start</p>
                <p className="text-lg font-bold">
                  {players.length}/3 Players Joined
                </p>
              </div>
            </Card>
          </motion.div>
        );

      case 'KEY_EXCHANGE':
        return (
          <motion.div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Card className="bg-black/80 border-white/20">
              <div className="p-6 text-center text-white">
                <Shield className="w-12 h-12 mb-4 mx-auto text-blue-500 animate-pulse" />
                <h3 className="text-xl font-bold mb-2">Setting Up Encryption</h3>
                <p className="text-white/70">Securing the card dealing process...</p>
                <Button onClick={handleEncryption}>Submit Encryption Key</Button>

              </div>
            </Card>
          </motion.div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="relative w-full h-screen bg-gradient-to-b from-gray-900 to-gray-800 overflow-hidden">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-center p-4 text-white">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span className="text-sm font-medium">
            Session: {formatSessionTime(sessionTime)}
          </span>
        </div>

        {/* Game Status */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="text-sm">Players: {players.length}/6</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span className="text-sm">{dealingPhase}</span>
          </div>
        </div>
      </div>

      {/* Poker Table */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px]">
        <motion.div 
          className="relative w-full h-full bg-green-800 rounded-[200px] border-8 border-brown-900 shadow-2xl"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {/* Table Center */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white text-center">
            <div className="text-sm opacity-80 mb-1">Waiting to Start</div>
            {isDealer && dealingPhase === 'WAITING_FOR_PLAYERS' && (
              <div className="text-xs opacity-60 mt-2">
                Game will start automatically when 3 players join
              </div>
            )}
          </div>

          {/* Community Cards */}
          {renderCommunityCards()}

          {/* Players */}
          {players.map((player) => (
            <div
              key={player.id}
              className={cn(
                "absolute flex flex-col items-center",
                player.position === 'bottom' && "bottom-0 left-1/2 -translate-x-1/2 mb-4",
                player.position === 'right' && "right-0 top-1/2 -translate-y-1/2 mr-4",
                player.position === 'top-right' && "right-1/4 top-0 mt-4",
                player.position === 'top' && "top-0 left-1/2 -translate-x-1/2 mt-4",
                player.position === 'top-left' && "left-1/4 top-0 mt-4",
                player.position === 'left' && "left-0 top-1/2 -translate-y-1/2 ml-4"
              )}
            >
              <div className="relative">
                <Card className="w-32 bg-gray-900 text-white p-2">
                  <div className="text-sm font-medium">{player.name}</div>
                  <div className="text-lg font-bold">${player.chips.toLocaleString()}</div>
                </Card>
                {player.isDealer && (
                  <Badge className="absolute -top-2 -right-2 bg-yellow-500">
                    Dealer
                  </Badge>
                )}
              </div>
              
              {renderPlayerCards(player)}
            </div>
          ))}
        </motion.div>
      </div>

      {/* Phase Overlay */}
      {renderPhaseOverlay()}

      {/* Development Debug Panel */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 left-4 bg-black/80 text-white text-xs p-2 rounded">
          <div>Phase: {dealingPhase}</div>
          <div>Players: {players.length}</div>
          <div>Is Dealer: {isDealer ? 'Yes' : 'No'}</div>
          <div>Your Address: {connectedPushAddressFormat?.slice(0, 6)}...</div>
          <div>Cards Dealt: {game?.cards?.length || 0}</div>
        </div>
      )}
    </div>
  );
}