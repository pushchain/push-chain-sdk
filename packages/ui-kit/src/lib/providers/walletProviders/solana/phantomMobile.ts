import { ChainType } from '../../../types/wallet.types';

const PHANTOM_BROWSE_BASE_URL = 'https://phantom.app/ul/browse';

export const PHANTOM_PROVIDER_NAME = 'Phantom';
export const PHANTOM_MOBILE_CONNECT_PARAM = 'pua_phantom_mobile_connect';

export const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const isTouchMac =
    /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;

  return isIOS || isAndroid || isTouchMac;
};

export const hasPhantomSolanaProvider = (): boolean => {
  return typeof window !== 'undefined' && !!window.phantom?.solana;
};

export const shouldOpenPhantomMobileBrowser = (
  chainType?: ChainType
): boolean => {
  const targetChain = chainType || ChainType.SOLANA;

  return (
    targetChain === ChainType.SOLANA &&
    isMobileDevice() &&
    !hasPhantomSolanaProvider()
  );
};

export const hasPhantomMobileConnectRequest = (): boolean => {
  if (typeof window === 'undefined') return false;

  return new URL(window.location.href).searchParams.has(
    PHANTOM_MOBILE_CONNECT_PARAM
  );
};

export const consumePhantomMobileConnectRequest = (): ChainType | null => {
  if (typeof window === 'undefined') return null;

  const url = new URL(window.location.href);
  const requestedChain = url.searchParams.get(PHANTOM_MOBILE_CONNECT_PARAM);

  if (!requestedChain) return null;

  url.searchParams.delete(PHANTOM_MOBILE_CONNECT_PARAM);
  window.history.replaceState(
    window.history.state,
    document.title,
    `${url.pathname}${url.search}${url.hash}`
  );

  return requestedChain === ChainType.SOLANA ? ChainType.SOLANA : null;
};

export const buildPhantomMobileBrowseUrl = (
  chainType: ChainType = ChainType.SOLANA
): string => {
  if (typeof window === 'undefined') {
    throw new Error('Phantom mobile browser can only be opened in a browser');
  }

  const targetUrl = new URL(window.location.href);
  targetUrl.searchParams.set(PHANTOM_MOBILE_CONNECT_PARAM, chainType);

  return `${PHANTOM_BROWSE_BASE_URL}/${encodeURIComponent(
    targetUrl.toString()
  )}?ref=${encodeURIComponent(window.location.origin)}`;
};

export const openPhantomMobileBrowser = (
  chainType: ChainType = ChainType.SOLANA
): void => {
  window.location.assign(buildPhantomMobileBrowseUrl(chainType));
};
