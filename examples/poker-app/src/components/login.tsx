import { usePrivy } from '@privy-io/react-auth'
import { toBytes } from 'viem'
import { useAppContext } from '../hooks/useAppContext'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Separator } from './ui/seperator'
import { ChevronRight, Wallet } from 'lucide-react'
import { motion } from 'framer-motion'

const Login = () => {
  const { login } = usePrivy()
  const { pushNetwork, setPushAccount } = useAppContext()

  const pushWalletLoginHandler = async () => {
    try {
      if (pushNetwork) {
        const acc = await pushNetwork.wallet.connect()
        await pushNetwork.wallet.sign(toBytes('Accept Connection Request From DApp'))
        console.log('Connected account: ', acc)
        setPushAccount(acc)
      }
    } catch (err) {
      console.error(err)
      alert(err);
    }
  }

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        backgroundImage: 'url("https://cdn.dribbble.com/userupload/16376163/file/original-c975441fa1b24ea143580792b6f81deb.png?resize=752x&vertical=center")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
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

      {/* Glass overlay */}
      <div className="absolute inset-0 backdrop-blur-[2px] bg-black/70" />
      
      <motion.div 
        className="w-full max-w-md relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="backdrop-blur-xl bg-white/10 border-2 border-white/20 shadow-[0_0_15px_rgba(0,0,0,0.2)]">
          <CardHeader className="text-center space-y-2 pb-0">
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5 }}
            >
              <CardTitle className="text-5xl font-bold mb-2 bg-gradient-to-r from-[#FFD700] via-white to-[#FFD700] bg-clip-text text-transparent">
                ♠️ Poker App ♥️
              </CardTitle>
            </motion.div>
            <p className="text-white/80 text-sm font-medium">LOGIN TO PLAY</p>
          </CardHeader>
          
          <CardContent className="space-y-6 p-8">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button
                className="w-full bg-gradient-to-r from-[#FFD700] to-[#FDB931] text-gray-900 transition-all duration-300 py-6 text-lg font-bold shadow-xl hover:shadow-2xl hover:from-[#FDB931] hover:to-[#FFD700] group"
                onClick={login}
              >
                <Wallet className="mr-2 h-5 w-5" />
                Login with any wallet
                <ChevronRight className="ml-auto h-5 w-5 transform group-hover:translate-x-1 transition-transform" />
              </Button>
            </motion.div>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full bg-white/20" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-transparent px-2 text-white/60 font-medium">Or continue with</span>
              </div>
            </div>
            
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button
                className="w-full bg-gradient-to-r from-[#9333EA] to-[#7E22CE] text-white transition-all duration-300 py-6 text-lg font-bold shadow-xl hover:shadow-2xl hover:from-[#7E22CE] hover:to-[#9333EA] group"
                onClick={pushWalletLoginHandler}
              >
                <span className="mr-2 text-xl">🃏</span>
                Login with Push Wallet
                <ChevronRight className="ml-auto h-5 w-5 transform group-hover:translate-x-1 transition-transform" />
              </Button>
            </motion.div>
          </CardContent>
        </Card>
        
        <motion.div 
          className="mt-8 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <p className="text-white/90 text-sm font-medium drop-shadow-lg">
            Experience the thrill of decentralized poker
          </p>
        </motion.div>
      </motion.div>
    </div>
  )
}

export default Login

