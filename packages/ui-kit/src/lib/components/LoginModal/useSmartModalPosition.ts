import { useEffect, useState } from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { PushUI } from '../../constants';

type Position = { top: number; left: number };

export function useSmartModalPosition(
  triggerRef: React.RefObject<HTMLElement>,
  modalWidth = 450,
  modalHeight = 675,
  uid?: string,
): Position {
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });

  const { isWalletMinimised, universalAccount, config } = usePushWalletContext(uid);

  useEffect(() => {
    const calculatePosition = () => {
      if (!triggerRef.current) return;

      if (config.modal?.connectedLayout === PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL) {
        setPosition({ top: 0, left: 0 });
        return;
      }

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      const spaceRight = viewportWidth - triggerRect.left;
      const spaceLeft = triggerRect.right;

      const top =
        spaceBelow >= modalHeight
          ? triggerRect.bottom + 4
          : spaceAbove >= modalHeight
          ? triggerRect.top - modalHeight - 4
          : Math.max(viewportHeight - modalHeight, 0);

      const left =
        spaceRight >= modalWidth
          ? triggerRect.left
          : spaceLeft >= modalWidth
          ? triggerRect.right - modalWidth
          : Math.max(viewportWidth - modalWidth, 0);

      setPosition({ top, left });
    };

    if (!isWalletMinimised) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    calculatePosition();
    window.addEventListener('resize', calculatePosition);
    return () => {
      window.removeEventListener('resize', calculatePosition);
      document.body.style.overflow = '';
    };
  }, [triggerRef, modalWidth, modalHeight, isWalletMinimised, config]);

  useEffect(() => {
    if (!universalAccount) {
        setPosition({top: 0, left: 0});
    }
  }, [universalAccount])

  return position;
}
