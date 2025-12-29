
export type Currency = 'toman' | 'tether';
export type TradeType = 'buy' | 'sell';
export type FeeType = 'percentage' | 'fixed';

export interface Asset {
  id: string;
  symbol: string; // e.g., BTC, GOLD
  name: string;   // e.g., Bitcoin, Gold 18k
  amount: number;
  avgBuyPrice: number; // In Toman
  currentPrice: number; // In Toman (for simulation)
}

export interface Trade {
  id: string;
  portfolioId: string;
  type: TradeType;
  assetName: string;
  amount: number;
  price: number;
  totalValue: number;
  fee: number;
  timestamp: string; // ISO date
  realizedPnl?: number; // Profit/Loss for sell trades
}

export interface Portfolio {
  id: string;
  name: string;
  allocation: number; // Budget allocated to this portfolio (in Toman)
  assets: Asset[];
  children: Portfolio[]; // Nested portfolios
}

export interface NetWorthSnapshot {
  date: string; // ISO string
  value: number; // Total Net Worth (Cash + Assets)
}

export interface AppState {
  cash: number; // Total available liquid cash (Toman)
  tetherPrice: number; // Current Tether price in Toman
  rootPortfolios: Portfolio[]; // Top-level portfolios
  tradeHistory: Trade[];
  netWorthHistory: NetWorthSnapshot[]; // History of total account value
  selectedPortfolioId: string | null; // Currently selected for viewing/trading
}

export const INITIAL_STATE: AppState = {
  cash: 1000000000, // 1 Billion Toman default
  tetherPrice: 60000,
  rootPortfolios: [
    {
      id: 'p-1',
      name: 'سبد بورس',
      allocation: 300000000,
      assets: [],
      children: [
        {
          id: 'p-1-1',
          name: 'صندوق‌های سهامی',
          allocation: 100000000,
          assets: [],
          children: []
        }
      ]
    },
    {
      id: 'p-2',
      name: 'سبد طلا و سکه',
      allocation: 200000000,
      assets: [],
      children: []
    }
  ],
  tradeHistory: [],
  netWorthHistory: [
    { date: new Date().toISOString(), value: 1000000000 }
  ],
  selectedPortfolioId: 'p-1'
};
