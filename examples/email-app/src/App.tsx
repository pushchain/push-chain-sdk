import { usePrivy } from '@privy-io/react-auth';
import LoggedInView from './components/ui/logged-in-view';
import Login from './components/ui/login';
import { useAppContext } from './context/app-context';

function App() {
  const { ready, authenticated } = usePrivy();
  const { pushAccount } = useAppContext();
  return (
    <>
      {ready ? (
        <main className="h-screen w-screen">
          {authenticated || pushAccount ? <LoggedInView /> : <Login />}
        </main>
      ) : (
        <div className="flex flex-col gap-4 items-center justify-center h-screen w-full">
          <div className="w-8 h-8 animate-ping bg-primary rounded-full"></div>
          <p>Loading</p>
        </div>
      )}
    </>
  );
}

export default App;
