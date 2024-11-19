import { usePrivy } from '@privy-io/react-auth';
import { usePushContext } from './usePushContext.tsx';
import { Login } from './components/login.tsx';

function App() {
  const { ready, authenticated } = usePrivy();
  const { pushAccount } = usePushContext();

  if (!ready) {
    return (
      <div className="flex flex-col gap-4 items-center justify-center h-screen w-full">
        <div className="w-8 h-8 animate-spin rounded-full border-t-2 border-b-2 border-blue-500"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (authenticated || pushAccount) {
    return <div>you are logged in</div>;
  } else {
    return <Login />;
  }
}

export default App;
