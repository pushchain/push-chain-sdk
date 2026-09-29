const isOnScreen = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight
  );
};

/**
 * The trigger to anchor the modal to: the active one if it is on screen,
 * otherwise the first on-screen trigger. The active trigger can be hidden or
 * off-canvas, e.g. a button inside a closed mobile drawer that mounted when a
 * docked browser side panel narrowed the viewport.
 */
export const resolveModalTrigger = (
  triggerId: string | null,
  triggers: Record<string, HTMLElement | null>,
): HTMLElement | null => {
  const active = triggerId ? triggers[triggerId] ?? null : null;
  if (active && isOnScreen(active)) return active;

  const visible = Object.values(triggers).find(
    (el): el is HTMLElement => !!el && isOnScreen(el),
  );
  return visible ?? active;
};
