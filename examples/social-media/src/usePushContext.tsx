import {useContext} from "react";
import {PushContext} from "./context/push-context.tsx";

export function usePushContext() {
    const context = useContext(PushContext);
    if (context === undefined) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
}