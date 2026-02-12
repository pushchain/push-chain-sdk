export type EIP6963ProviderDetail = {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: any;
};

const providers = new Map<string, EIP6963ProviderDetail>();
let isListening = false;

export function startEIP6963Listener() {
  if (isListening || typeof window === "undefined") return;
  isListening = true;

  window.addEventListener("eip6963:announceProvider", ((event: any) => {
    const detail = event.detail as EIP6963ProviderDetail;
    if (!detail?.info?.rdns) return;
    providers.set(detail.info.rdns, detail);
  }) as EventListener);

  const requestEvent = new CustomEvent("eip6963:requestProvider");
  window.dispatchEvent(requestEvent);
}

export function getEIP6963ProviderByRdns(rdns: string) {
  return providers.get(rdns)?.provider;
}

export function getAllEIP6963Providers() {
  return Array.from(providers.values());
}
