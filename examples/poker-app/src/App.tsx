import { usePrivy } from '@privy-io/react-auth';
import Login from './components/login';
import LoggedInView from './components/logged-in-view';
import { useAppContext } from './hooks/useAppContext.tsx';

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
          <div className="w-8 h-8 animate-spin rounded-full border-t-2 border-b-2 border-blue-500"></div>
          <p>Loading...</p>
        </div>
      )}
    </>
  );
}

export default App;
