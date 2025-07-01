import { useEffect, useState } from 'react';

type Position = { top: number; left: number };

export function useSmartModalPosition(
  triggerRef: React.RefObject<HTMLElement>,
  modalWidth = 450,
  modalHeight = 675,
  isVisible: boolean
): Position {
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });

  console.log(isVisible);

  useEffect(() => {
    const calculatePosition = () => {
      if (!triggerRef.current) return;

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

    calculatePosition();
    window.addEventListener('resize', calculatePosition);
    return () => window.removeEventListener('resize', calculatePosition);
  }, [triggerRef, modalWidth, modalHeight, isVisible]);

  return position;
}
