import { useRef, useState } from 'react';

const useTimer = () => {
  const [playerTimer, setPlayerTimer] = useState(120);

  const playerTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startPlayerTimer = () => {
    if (playerTimerRef.current) clearInterval(playerTimerRef.current);
    setPlayerTimer(120);

    playerTimerRef.current = setInterval(() => {
      setPlayerTimer((prev) => {
        if (prev <= 1) {
          clearInterval(playerTimerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  return { playerTimer, playerTimerRef, startPlayerTimer };
};

export { useTimer };
