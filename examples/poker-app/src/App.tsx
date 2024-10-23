import { usePrivy } from '@privy-io/react-auth';
import './App.css';
import Login from './components/login';
import { useAppContext } from './context/app-context';
import LoggedInView from './components/logged-in-view';

function App() {
  const { ready, authenticated } = usePrivy();
  const { pushAccount } = useAppContext();

  return (
    <div className="flex justify-center items-center h-screen">
      {ready ? (
        authenticated || pushAccount ? (
          <LoggedInView />
        ) : (
          <Login />
        )
      ) : (
        <div className="flex flex-col gap-4 items-center justify-center">
          <div className="w-8 h-8 animate-spin rounded-full border-t-2 border-b-2 border-blue-500"></div>
          <p>Loading...</p>
        </div>
      )}
    </div>
  );
}

export default App;
