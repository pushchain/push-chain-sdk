import { usePrivy } from '@privy-io/react-auth';
import LoggedOutView from './components/logged-out-view';
import LoggedInView from './components/logged-in-view';
import LoadingSpinner from './components/ui/spinner';
import { useAppContext } from './context/app-context';

function App() {
  const { ready, authenticated } = usePrivy();
  const { pushAccount } = useAppContext();

  return (
    <>
      {!ready && (
        <div className="w-screen h-screen flex justify-center items-center">
          <LoadingSpinner size="lg" />
        </div>
      )}
      {ready && !pushAccount && !authenticated && <LoggedOutView />}
      {ready && (pushAccount || authenticated) && <LoggedInView />}
    </>
  );
}

export default App;
