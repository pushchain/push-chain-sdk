import { useState, useEffect } from 'react';
import Navbar from './navbar';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Game from './game';
import PublicGames from './public-games';
import useConnectedPushAddress from '../hooks/useConnectedPushAddress';
import usePushWalletSigner from '../hooks/usePushSigner';
import { usePokerGameContext } from '../hooks/usePokerGameContext';
import { useAppContext } from '../hooks/useAppContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Separator } from './ui/seperator';
import { ChevronRight, Plus, Users, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';
import { Phase, PhaseType, Player, PokerGame } from '../temp_types/types.ts';


export default function LoggedInView() {
  const [friendsWallets, setFriendsWallets] = useState<string[]>([]);
  const [loadingStartGame, setLoadingStartGame] = useState<boolean>(false);
  const [walletInput, setWalletInput] = useState<string>('');
  const [recommendedWallets, setRecommendedWallets] = useState<string[]>([]);
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const { pushWalletSigner } = usePushWalletSigner();
  const { setGame,pokerService, gameTransactionHash, setGameTransactionHash } = usePokerGameContext();
  const { gameStarted, setGameStarted } = useAppContext();

  useEffect(() => {
    const storedWallets = localStorage.getItem('poker-friends-wallets');
    if (storedWallets) {
      setRecommendedWallets(JSON.parse(storedWallets));
    }
  }, []);

  const handleAddFriend = (recommendedWallet?: string) => {
    if (friendsWallets.length >= 4) {
      toast.error('Only a maximum of 4 players can be added.');
      return;
    }
    const walletToAdd = recommendedWallet || walletInput;
    if (walletToAdd.startsWith('solana:') || walletToAdd.startsWith('eip155:')) {
      setFriendsWallets([...friendsWallets, walletToAdd]);
      setWalletInput('');
      if (!recommendedWallets.includes(walletToAdd)) {
        const updatedRecommendedWallets = [...recommendedWallets, walletToAdd];
        localStorage.setItem('poker-friends-wallets', JSON.stringify(updatedRecommendedWallets));
        setRecommendedWallets(updatedRecommendedWallets);
      }
    } else {
      toast.error('Wallet should be in CAIP10 format or PUSH format (e.g. eip155:1:0x1234567890)');
    }
  };

  const handleRemoveFriend = (wallet: string) => {
    setFriendsWallets(friendsWallets.filter((w) => w !== wallet));
  };

  const handleCreateGame = async (type: 'public' | 'private') => {
    try {
      setLoadingStartGame(true);
      if (!connectedPushAddressFormat || !pushWalletSigner || !pokerService) return;
  
      // Create game data locally and set it in context
      const pokerGame: PokerGame = {
        players: new Map<string, Player>([
          [connectedPushAddressFormat, { chips: 100, cards: [] }],
        ]),
        phases: new Map<PhaseType, Phase>(),
        cards: [],
        pot: 0,
        creator: connectedPushAddressFormat,
        dealer: connectedPushAddressFormat,
      };
  
      // Update the context with the initial game data
      
  
      // Call the API to create the game on the backend
      const tx = await pokerService.createGame(
        { type },
        [connectedPushAddressFormat, ...friendsWallets],
        pushWalletSigner
      );

      setGame(pokerGame);
  
      // Store the transaction hash in context
      setGameTransactionHash(tx);
      setGameStarted(true);
    } catch (error) {
      console.error(error);
      toast.error('Failed to create game');
    } finally {
      setLoadingStartGame(false);
    }
  };
  

  if (gameStarted) {
    return <Game />;
  }

  return (
    <div 
      className="min-h-screen relative overflow-hidden"
      style={{
        backgroundImage: 'url("https://cdn.dribbble.com/userupload/16376163/file/original-c975441fa1b24ea143580792b6f81deb.png?resize=752x&vertical=center")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      {/* Glass overlay */}
      <div className="absolute inset-0 backdrop-blur-[2px] bg-black/70" />
      
      {/* Animated poker chips */}
      <motion.div 
        className="absolute top-20 -left-20 w-40 h-40 opacity-80"
        animate={{ 
          rotate: 360,
          y: [0, -20, 0],
        }}
        transition={{ 
          rotate: { duration: 20, repeat: Infinity, ease: "linear" },
          y: { duration: 2, repeat: Infinity, ease: "easeInOut" }
        }}
      >
        <img src="/src/assets/poker-red.jpg" alt="" className="w-full h-full object-contain" />
      </motion.div>
      
      <motion.div 
        className="absolute bottom-20 -right-20 w-40 h-40 opacity-80"
        animate={{ 
          rotate: -360,
          y: [0, 20, 0],
        }}
        transition={{ 
          rotate: { duration: 20, repeat: Infinity, ease: "linear" },
          y: { duration: 2.5, repeat: Infinity, ease: "easeInOut" }
        }}
      >
        <img src="/src/assets/poker-red.jpg" alt="" className="w-full h-full object-contain" />
      </motion.div>

      <Navbar />
      <ToastContainer />
      
      <div className="container mx-auto px-4 py-8 relative z-10">
        <motion.h1 
          className="text-5xl font-bold mb-12 text-center bg-gradient-to-r from-[#FFD700] via-white to-[#FFD700] bg-clip-text text-transparent"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          ♠️ Poker App ♥️
        </motion.h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="backdrop-blur-xl bg-white/10 border-2 border-white/20 shadow-[0_0_15px_rgba(0,0,0,0.2)]">
              <CardHeader>
                <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                  <Trophy className="h-6 w-6 text-[#FFD700]" /> Create Game
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    onClick={() => handleCreateGame('public')}
                    disabled={loadingStartGame}
                    className="w-full bg-gradient-to-r from-[#FFD700] to-[#FDB931] text-gray-900 transition-all duration-300 py-6 text-lg font-bold shadow-xl hover:shadow-2xl hover:from-[#FDB931] hover:to-[#FFD700] group"
                  >
                    {loadingStartGame ? 'Creating...' : 'Create public game'}
                    <ChevronRight className="ml-auto h-5 w-5 transform group-hover:translate-x-1 transition-transform" />
                  </Button>
                </motion.div>

                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    onClick={() => handleCreateGame('private')}
                    disabled={loadingStartGame || friendsWallets.length === 0}
                    className="w-full bg-gradient-to-r from-[#9333EA] to-[#7E22CE] text-white transition-all duration-300 py-6 text-lg font-bold shadow-xl hover:shadow-2xl hover:from-[#7E22CE] hover:to-[#9333EA] group"
                  >
                    {loadingStartGame ? 'Creating...' : 'Create game with friends'}
                    <ChevronRight className="ml-auto h-5 w-5 transform group-hover:translate-x-1 transition-transform" />
                  </Button>
                </motion.div>

                {gameTransactionHash && (
                  <div className="text-sm text-white/60 bg-black/20 p-3 rounded-lg backdrop-blur-sm">
                    Transaction hash: {gameTransactionHash}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <Card className="backdrop-blur-xl bg-white/10 border-2 border-white/20 shadow-[0_0_15px_rgba(0,0,0,0.2)]">
              <CardHeader>
                <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                  <Users className="h-6 w-6 text-[#FFD700]" /> Add Friends
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Enter friend's wallet address"
                    value={walletInput}
                    onChange={(e) => setWalletInput(e.target.value)}
                    className="flex-grow bg-white/10 border-white/20 text-white placeholder:text-white/60"
                  />
                  <Button 
                    onClick={() => handleAddFriend()} 
                    disabled={!walletInput}
                    className="bg-[#FFD700] hover:bg-[#FDB931] text-gray-900"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>

                {recommendedWallets.length > 0 && (
                  <div className="space-y-3">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <Separator className="w-full bg-white/20" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-transparent px-2 text-white/60 font-medium">Previously added friends</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recommendedWallets.map((wallet) => (
                        <Button
                          key={wallet}
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddFriend(wallet)}
                          className="border-white/20 text-white hover:bg-white/10"
                        >
                          {wallet.slice(0, 6)}...{wallet.slice(-4)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {friendsWallets.length > 0 && (
                  <div className="space-y-3">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <Separator className="w-full bg-white/20" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-transparent px-2 text-white/60 font-medium">Added Friends</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {friendsWallets.map((wallet) => (
                        <motion.div
                          key={wallet}
                          className="flex justify-between items-center p-3 rounded-lg bg-white/10 backdrop-blur-sm"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <span className="text-white">{wallet.slice(0, 6)}...{wallet.slice(-4)}</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleRemoveFriend(wallet)}
                            className="bg-red-500/80 hover:bg-red-600/80"
                          >
                            Remove
                          </Button>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <motion.div 
          className="mt-12"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <PublicGames />
        </motion.div>
      </div>
    </div>
  );
}

