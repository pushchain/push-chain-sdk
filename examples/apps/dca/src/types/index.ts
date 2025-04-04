import {
  BalanceItem,
  DexReport,
  GoldRushResponse,
  LendingReport,
  NftSalesReport,
  SafeDetails,
} from '@covalenthq/client-sdk';

// Generic Types
export type Chain = string;
export type ChainID = number;
export type ChainName = string;
export type Quote =
  | 'USD'
  | 'CAD'
  | 'EUR'
  | 'SGD'
  | 'INR'
  | 'JPY'
  | 'VND'
  | 'CNY'
  | 'KRW'
  | 'RUB'
  | 'TRY'
  | 'NGN'
  | 'ARS'
  | 'AUD'
  | 'CHF'
  | 'GBP';

export type PaginationLinks = {
  next: string | null;
  prev: string | null;
};

export type Explorer = {
  label: string;
  url: string;
};

export type ContractMetadata = {
  contract_decimals: number;
  contract_name: string;
  contract_ticker_symbol: string;
  contract_address: string;
  logo_url: string | null;
};

// Log Event Types
export type DecodedParam = {
  name: string;
  type: string;
  value: string;
};

export type LogEvent = {
  block_signed_at: Date;
  block_height: number;
  tx_offset: number;
  log_offset: number;
  tx_hash: string;
  raw_log_topics: string[];
  sender_contract_decimals: number;
  sender_name: string;
  sender_contract_ticker_symbol: string;
  sender_address: string;
  sender_address_label: string | null;
  sender_logo_url: string | null;
  raw_log_data: string;
  decoded: {
    name: string;
    signature: string;
    params: DecodedParam[];
  } | null;
};

// Transaction Types
export interface Transaction {
  block_signed_at: Date;
  block_height: number;
  block_hash: string;
  tx_hash: string;
  tx_offset: number;
  successful: boolean;
  from_address: string;
  from_address_label: string | null;
  to_address: string;
  to_address_label: string | null;
  value: bigint;
  value_quote: number;
  pretty_value_quote: string;
  gas_offered: number;
  gas_spent: number;
  gas_price: number;
  fees_paid: bigint;
  gas_quote: number;
  pretty_gas_quote: string;
  gas_quote_rate: number;
  log_events: LogEvent[];
  miner_address: string;
  gas_metadata: ContractMetadata;
  explorers: Explorer[];
  dex_details: DexReport[];
  nft_sale_details: NftSalesReport[];
  lending_details: LendingReport[];
  safe_details: SafeDetails[];
}

// Response Types
export interface TransactionsResponse {
  address: string;
  updated_at: Date;
  quote_currency: Quote;
  chain_id: ChainID;
  chain_name: ChainName;
  current_page: number;
  links: PaginationLinks;
  next: (() => Promise<GoldRushResponse<TransactionsResponse>>) | null;
  prev: (() => Promise<GoldRushResponse<TransactionsResponse>>) | null;
  items: Transaction[];
}

// Full Response Type
export type GetTransactionsForAddressV3Response =
  GoldRushResponse<TransactionsResponse>;

// Query Parameters Type
export interface GetTransactionsForAddressV3QueryParamOpts {
  quoteCurrency?: Quote;
  noLogs?: boolean;
  blockSignedAtAsc?: boolean;
  withSafe?: boolean;
}

// Function Type
export type GetTransactionsForAddressV3Function = (
  chainName: Chain,
  walletAddress: string,
  page: number,
  queryParamOpts?: GetTransactionsForAddressV3QueryParamOpts
) => Promise<GetTransactionsForAddressV3Response>;

export interface ProcessedTransaction {
  timestamp: Date;
  hash: string;
  amount: bigint;
  type: 'receive' | 'send';
  from: string;
  to: string;
  successful: boolean;
  value_quote?: number;
  pretty_value_quote?: string;
}

// Props interface for the AssetTransactionHistory component
export interface AssetTransactionHistoryProps {
  asset: BalanceItem;
  allTransactions: Transaction[];
  walletAddress: string;
}
