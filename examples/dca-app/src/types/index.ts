export interface Transaction {
  id: string;
  date: string;
  type: "buy" | "sell";
  coin: string;
  amount: number;
  price: number;
}

export interface Asset {
  coin: string;
  amount: number;
  value: number;
  price: number;
}
