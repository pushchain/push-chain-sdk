import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function trimAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(parseInt(timestamp, 10));

  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
  };

  if (isNaN(date.getTime())) {
    return 'Invalid Date'; // Handle invalid dates
  }

  return date.toLocaleDateString('en-GB', options);
}
