import './App.css'
import {usePrivy} from "@privy-io/react-auth";
import {usePushContext} from "./usePushContext.tsx";

function App() {
    const {ready, authenticated} = usePrivy();
    const {pushAccount} = usePushContext()

    if (!ready) {
        return (
            <div className="flex flex-col gap-4 items-center justify-center h-screen w-full">
                <div className="w-8 h-8 animate-spin rounded-full border-t-2 border-b-2 border-blue-500"></div>
                <p>Loading...</p>
            </div>
        )
    }

    if (authenticated || pushAccount) {
        return <div>you are logged in</div>
    } else {
        return <div className="text-3xl font-bold underline">please log in</div>
    }
}

export default App
