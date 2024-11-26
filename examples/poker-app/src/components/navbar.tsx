import { usePrivy } from '@privy-io/react-auth'
import { Button } from './ui/button'
import { LogOut } from 'lucide-react'

const Navbar = () => {
  const { logout } = usePrivy()

  return (
    <nav className="relative z-20 backdrop-blur-md bg-black/20 border-b border-white/10">
      <div className="container mx-auto flex justify-between items-center p-4">
        <div className="text-2xl font-bold bg-gradient-to-r from-[#FFD700] to-white bg-clip-text text-transparent">
          ♠️ Poker App
        </div>
        <Button 
          onClick={logout} 
          variant="ghost" 
          className="text-white hover:bg-white/10 gap-2"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </nav>
  )
}

export default Navbar

