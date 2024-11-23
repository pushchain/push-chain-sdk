import { useContext } from 'react';
import { SocialContext } from '../context/social-context.tsx';

export function useSocialContext() {
  const context = useContext(SocialContext);
  if (context === undefined) {
    throw new Error('useSocialContext must be used within an AppProvider');
  }
  return context;
}
