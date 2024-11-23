import { createContext, Dispatch, SetStateAction } from 'react';
import { LoggedInProfile } from '../types';

interface SocialContextType {
  loggedInProfile: LoggedInProfile | null;
  setLoggedInProfile: Dispatch<SetStateAction<LoggedInProfile | null>>;
}

export const SocialContext = createContext<SocialContextType | undefined>(
  undefined
);
