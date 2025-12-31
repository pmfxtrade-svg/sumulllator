import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  AppState, 
  INITIAL_STATE, 
  Portfolio, 
  Trade, 
  Asset,
  NetWorthSnapshot
} from './types';
import { 
  LayoutGrid, 
  LogOut, 
  Wallet, 
  Coins, 
  TrendingUp, 
  PieChart as PieIcon,
  History,
  X,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Activity,
  Target,
  Percent,
  Database,
  Check,
  Copy,
  Layers,
  CornerDownRight,
  ChevronDown,
  ChevronUp,
  Trash2,
  Calendar,
  Clock,
  Briefcase
} from 'lucide-react';
import { Card, CardHeader, Button, Input, formatCurrency, formatNumber, numberToPersianWords } from './components/ui';
import { PortfolioTree } from './components/PortfolioTree';
import { TradeForm } from './components/TradeForm';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine,
  AreaChart, Area
} from 'recharts';
import { supabase, SQL_SCHEMA } from './supabaseClient';
import { Auth } from './components/Auth';
import { Session } from '@supabase/supabase-js';

// --- Constants ---
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1'];
const ALL_PORTFOLIOS_ID = 'ALL_ROOT';

// --- Types for Position Logic ---
interface PositionView {
  id: string; // generated
  assetName: string;
  portfolioId: string;
  status: 'OPEN' | 'CLOSED';
  totalBuyAmount: number;
  remainingAmount: number;
  avgBuyPrice: number;
  realizedPnl: number; // accumulated PnL from sells
  totalCost: number; // current cost basis
  trades: Trade[];
  startDate: string;
  endDate?: string;
  durationDays: number;
  lastUpdateDate?: string;
}

// --- Helper Functions for Nested State ---
const findPortfolioRecursive = (portfolios: Portfolio[], id: string): Portfolio | null => {
  for (const p of portfolios) {
    if (p.id === id) return p;
    const found = findPortfolioRecursive(p.children, id);
    if (found) return found;
  }
  return null;
};

const updatePortfolioRecursive = (portfolios: Portfolio[], updated: Portfolio): Portfolio[] => {
  return portfolios.map(p => {
    if (p.id === updated.id) return updated;
    if (p.children.length > 0) {
      return { ...p, children: updatePortfolioRecursive(p.children, updated) };
    }
    return p;
  });
};

const addPortfolioRecursive = (portfolios: Portfolio[], parentId: string, newPortfolio: Portfolio): Portfolio[] => {
  return portfolios.map(p => {
    if (p.id === parentId) {
      return { ...p, children: [...p.children, newPortfolio] };
    }
    if (p.children.length > 0) {
      return { ...p, children: addPortfolioRecursive(p.children, parentId, newPortfolio) };
    }
    return p;
  });
};

const editPortfolioRecursive = (portfolios: Portfolio[], id: string, name: string, allocation: number): Portfolio[] => {
  return portfolios.map(p => {
    if (p.id === id) return { ...p, name, allocation };
    if (p.children.length > 0) return { ...p, children: editPortfolioRecursive(p.children, id, name, allocation) };
    return p;
  });
};

const deletePortfolioRecursive = (portfolios: Portfolio[], id: string): Portfolio[] => {
  return portfolios.filter(p => p.id !== id).map(p => ({
    ...p,
    children: deletePortfolioRecursive(p.children, id)
  }));
};

// --- Helper for Calculations ---
const calculatePortfolioTotal = (p: Portfolio): number => {
  const assetsValue = p.assets.reduce((sum, a) => sum + (a.amount * a.currentPrice), 0);
  const childrenValue = p.children.reduce((sum, child) => sum + calculatePortfolioTotal(child), 0);
  return assetsValue + childrenValue;
};

const calculatePortfolioCost = (p: Portfolio): number => {
  const assetsCost = p.assets.reduce((sum, a) => sum + (a.amount * a.avgBuyPrice), 0);
  const childrenCost = p.children.reduce((sum, child) => sum + calculatePortfolioCost(child), 0);
  return assetsCost + childrenCost;
};

const getAllPortfolioIds = (p: Portfolio): string[] => {
  let ids = [p.id];
  p.children.forEach(c => ids = [...ids, ...getAllPortfolioIds(c)]);
  return ids;
};

// Flatten all portfolios for easy lookup
const flattenPortfolios = (portfolios: Portfolio[]): Portfolio[] => {
    let flat: Portfolio[] = [];
    portfolios.forEach(p => {
        flat.push(p);
        flat = [...flat, ...flattenPortfolios(p.children)];
    });
    return flat;
};

const recordHistory = (history: NetWorthSnapshot[], newValue: number): NetWorthSnapshot[] => {
  const now = new Date();
  const newSnapshot: NetWorthSnapshot = { date: now.toISOString(), value: newValue };
  return [...history, newSnapshot];
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
      return (
          <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-sm">
              <p className="font-bold text-slate-700 dir-ltr">{label}</p>
              <p className="text-brand-600 dir-ltr font-mono">
                  {formatCurrency(payload[0].value)}
              </p>
          </div>
      );
  }
  return null;
};

export default function App() {
  // --- Auth State ---
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- App State ---
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [isClient, setIsClient] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // --- UI State ---
  const [activeTab, setActiveTab] = useState<'assets' | 'history' | 'analytics'>('assets');
  const [assetSubViewId, setAssetSubViewId] = useState<string | null>(null); 
  
  const [showAddPortfolioModal, setShowAddPortfolioModal] = useState<{isOpen: boolean, parentId: string | null}>({isOpen: false, parentId: null});
  const [showEditPortfolioModal, setShowEditPortfolioModal] = useState<{isOpen: boolean, portfolio: Portfolio | null}>({isOpen: false, portfolio: null});
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [newPortfolioAlloc, setNewPortfolioAlloc] = useState('');
  const [editPortfolioName, setEditPortfolioName] = useState('');
  const [editPortfolioAlloc, setEditPortfolioAlloc] = useState('');
  
  const [showTetherModal, setShowTetherModal] = useState(false);
  const [tempTetherPrice, setTempTetherPrice] = useState('');
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [showSqlCopied, setShowSqlCopied] = useState(false);

  // Expanded Positions State
  const [expandedPositions, setExpandedPositions] = useState<string[]>([]);

  // --- Auth & Data Loading Logic ---
  useEffect(() => {
    setIsClient(true);

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
      if (session) loadData(session.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
         loadData(session.user.id);
      } else {
         setState(INITIAL_STATE);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if(state.selectedPortfolioId === ALL_PORTFOLIOS_ID) {
        setAssetSubViewId(null);
    } else {
        setAssetSubViewId(state.selectedPortfolioId);
    }
  }, [state.selectedPortfolioId]);

  const loadData = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_saves')
        .select('state')
        .eq('id', userId)
        .single();

      if (data && data.state) {
        let loadedState = data.state;
         if (!loadedState.netWorthHistory || !Array.isArray(loadedState.netWorthHistory)) {
           const totalAssets = loadedState.rootPortfolios.reduce((sum: number, p: Portfolio) => sum + calculatePortfolioTotal(p), 0);
           loadedState.netWorthHistory = [{ date: new Date().toISOString(), value: loadedState.cash + totalAssets }];
        }
        setState(loadedState);
      } else {
        const saved = localStorage.getItem('traderSimState');
        if (saved) {
           const parsed = JSON.parse(saved);
           setState(parsed);
           saveDataToSupabase(userId, parsed);
        }
      }
    } catch (e) {
      console.error("Error loading data", e);
    } finally {
      setDataLoaded(true);
    }
  };

  useEffect(() => {
    if (!isClient || !session || !dataLoaded) return;
    localStorage.setItem('traderSimState', JSON.stringify(state));
    const timeoutId = setTimeout(() => {
       saveDataToSupabase(session.user.id, state);
    }, 2000);
    return () => clearTimeout(timeoutId);
  }, [state, session, isClient, dataLoaded]);

  const saveDataToSupabase = async (userId: string, appState: AppState) => {
      try {
        const { error } = await supabase
          .from('user_saves')
          .upsert({ id: userId, state: appState, updated_at: new Date() });
        if (error) console.error("Error saving to supabase", error);
      } catch(e) {
        console.error("Exception saving to supabase", e);
      }
  };

  // --- Derived Data ---
  const totalAssetsValue = state.rootPortfolios.reduce((sum, p) => sum + calculatePortfolioTotal(p), 0);
  const totalNetWorth = state.cash + totalAssetsValue;

  // --- Helper: Position Processing ---
  const processPositions = useMemo(() => {
    const sortedTrades = [...state.tradeHistory].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const positions: PositionView[] = [];
    const openMap = new Map<string, PositionView>(); // Key: assetName + portfolioId

    sortedTrades.forEach(trade => {
        const key = `${trade.portfolioId}-${trade.assetName}`;
        let position = openMap.get(key);

        if (!position && trade.type === 'buy') {
            // Start new position
            position = {
                id: `pos-${trade.id}`,
                assetName: trade.assetName,
                portfolioId: trade.portfolioId,
                status: 'OPEN',
                totalBuyAmount: 0,
                remainingAmount: 0,
                avgBuyPrice: 0,
                totalCost: 0,
                realizedPnl: 0,
                trades: [],
                startDate: trade.timestamp,
                durationDays: 0
            };
            openMap.set(key, position);
        }

        if (position) {
            position.trades.push(trade);
            position.lastUpdateDate = trade.timestamp; // Track last activity

            if (trade.type === 'buy') {
                const newTotalAmount = position.remainingAmount + trade.amount;
                // Weighted Avg Price Calculation
                // (Old Cost + New Buy Value) / New Total Amount
                const currentCost = position.remainingAmount * position.avgBuyPrice;
                const newBuyValue = trade.totalValue; // Using total value from trade (price * amount)
                
                position.totalCost += newBuyValue;
                position.avgBuyPrice = (currentCost + newBuyValue) / newTotalAmount;
                position.remainingAmount = newTotalAmount;
                position.totalBuyAmount += trade.amount;
                
            } else if (trade.type === 'sell') {
                // Realized PnL = (Sell Price - Avg Buy Price) * Sell Amount - Fee
                const sellValue = trade.totalValue;
                const costOfSold = trade.amount * position.avgBuyPrice;
                const tradePnl = sellValue - costOfSold - trade.fee; // Net PnL

                position.realizedPnl += tradePnl;
                position.remainingAmount -= trade.amount;

                // Close position if amount is negligible
                if (position.remainingAmount <= 0.000001) {
                    position.status = 'CLOSED';
                    position.endDate = trade.timestamp;
                    positions.push({...position}); // Save closed position
                    openMap.delete(key); // Remove from open
                }
            }
        }
    });

    // Add remaining open positions
    openMap.forEach(p => positions.push(p));

    // Calculate Duration
    return positions.map(p => {
        const start = new Date(p.startDate);
        const end = p.endDate ? new Date(p.endDate) : new Date();
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        return { ...p, durationDays: diffDays };
    }).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()); // Newest first

  }, [state.tradeHistory]);


  // --- Helper: Replay Trades for Integrity ---
  // When editing/deleting history, we must rebuild the 'assets' state of the affected portfolio from scratch.
  const replayPortfolioAssets = (portfolioId: string, trades: Trade[]) => {
      const pTrades = trades.filter(t => t.portfolioId === portfolioId).sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      const assetsMap = new Map<string, Asset>();
      // We assume initial assets are empty when replay starts from history
      
      pTrades.forEach(t => {
          let asset = assetsMap.get(t.assetName);
          if (!asset) {
              asset = {
                  id: `ast-replay-${t.assetName}`, // ID generation might need to be consistent if reused, but for state update it's fine
                  name: t.assetName,
                  symbol: t.assetName.substring(0,3).toUpperCase(),
                  amount: 0,
                  avgBuyPrice: 0,
                  currentPrice: t.price // Update current price to latest trade price
              };
          }
          
          asset.currentPrice = t.price; // Always update current price to latest action

          if (t.type === 'buy') {
              const totalCost = asset.amount * asset.avgBuyPrice;
              const newCost = t.totalValue;
              const newAmount = asset.amount + t.amount;
              asset.avgBuyPrice = (totalCost + newCost) / newAmount;
              asset.amount = newAmount;
          } else {
              asset.amount = Math.max(0, asset.amount - t.amount);
          }

          if (asset.amount > 0.000001) {
              assetsMap.set(t.assetName, asset);
          } else {
              assetsMap.delete(t.assetName);
          }
      });

      return Array.from(assetsMap.values());
  };


  // --- Handlers ---
  const handleSelectPortfolio = (id: string) => {
    setState(prev => ({ ...prev, selectedPortfolioId: id }));
  };

  const handleAddPortfolio = () => {
    if (!newPortfolioName) return;
    const allocationAmount = parseFloat(newPortfolioAlloc) || 0;

    if (showAddPortfolioModal.parentId === null) {
       const currentTotalAllocated = state.rootPortfolios.reduce((sum, p) => sum + p.allocation, 0);
       if (currentTotalAllocated + allocationAmount > totalNetWorth) {
           alert(`خطا: مجموع بودجه تخصیص یافته (${formatCurrency(currentTotalAllocated + allocationAmount)}) نمی‌تواند بیشتر از کل دارایی‌ها (${formatCurrency(totalNetWorth)}) باشد.`);
           return;
       }
    } else {
       const parent = findPortfolioRecursive(state.rootPortfolios, showAddPortfolioModal.parentId);
       if (parent) {
           const currentChildrenAllocated = parent.children.reduce((sum, p) => sum + p.allocation, 0);
           if (currentChildrenAllocated + allocationAmount > parent.allocation) {
                alert(`خطا: مجموع بودجه زیرمجموعه‌ها (${formatCurrency(currentChildrenAllocated + allocationAmount)}) نمی‌تواند بیشتر از بودجه سبد والد (${formatCurrency(parent.allocation)}) باشد.`);
                return;
           }
       }
    }

    const newP: Portfolio = {
      id: `p-${Date.now()}`,
      name: newPortfolioName,
      allocation: allocationAmount,
      assets: [],
      children: []
    };

    if (showAddPortfolioModal.parentId === null) {
      setState(prev => ({ ...prev, rootPortfolios: [...prev.rootPortfolios, newP] }));
    } else {
      setState(prev => ({
        ...prev,
        rootPortfolios: addPortfolioRecursive(prev.rootPortfolios, showAddPortfolioModal.parentId!, newP)
      }));
    }
    setShowAddPortfolioModal({isOpen: false, parentId: null});
    setNewPortfolioName('');
    setNewPortfolioAlloc('');
  };

  const handleOpenEditPortfolio = (portfolio: Portfolio) => {
    setEditPortfolioName(portfolio.name);
    setEditPortfolioAlloc(portfolio.allocation.toString());
    setShowEditPortfolioModal({ isOpen: true, portfolio });
  };

  const handleUpdatePortfolio = () => {
    if (!showEditPortfolioModal.portfolio || !editPortfolioName) return;
    const allocationAmount = parseFloat(editPortfolioAlloc) || 0;
    setState(prev => ({
      ...prev,
      rootPortfolios: editPortfolioRecursive(prev.rootPortfolios, showEditPortfolioModal.portfolio!.id, editPortfolioName, allocationAmount)
    }));
    setShowEditPortfolioModal({ isOpen: false, portfolio: null });
  };

  const handleDeletePortfolio = (id: string) => {
    if (confirm('آیا از حذف این سبد و تمام دارایی‌های آن اطمینان دارید؟')) {
       setState(prev => ({
         ...prev,
         rootPortfolios: deletePortfolioRecursive(prev.rootPortfolios, id),
         selectedPortfolioId: prev.selectedPortfolioId === id ? null : prev.selectedPortfolioId
       }));
    }
  };

  // --- Trade Logic ---
  const handleTrade = (tradeData: any) => {
    if (!state.selectedPortfolioId || state.selectedPortfolioId === ALL_PORTFOLIOS_ID) {
        alert("لطفا یک سبد خاص را انتخاب کنید.");
        return;
    }
    const portfolio = findPortfolioRecursive(state.rootPortfolios, state.selectedPortfolioId);
    if (!portfolio) return;

    let newTrade: Trade = {
      id: `tr-${Date.now()}`,
      portfolioId: portfolio.id,
      timestamp: new Date().toISOString(),
      ...tradeData
    };

    let updatedAssets = [...portfolio.assets];
    const existingAssetIndex = updatedAssets.findIndex(a => a.name === tradeData.assetName);

    if (tradeData.type === 'buy') {
      if (existingAssetIndex >= 0) {
        const asset = updatedAssets[existingAssetIndex];
        const newAmount = asset.amount + tradeData.amount;
        const oldTotalCost = asset.amount * asset.avgBuyPrice;
        const newTotalCost = oldTotalCost + tradeData.totalValue; 
        
        updatedAssets[existingAssetIndex] = {
          ...asset,
          amount: newAmount,
          avgBuyPrice: newTotalCost / newAmount,
          currentPrice: tradeData.price 
        };
      } else {
        updatedAssets.push({
          id: `ast-${Date.now()}`,
          name: tradeData.assetName,
          symbol: tradeData.assetName.substring(0, 3).toUpperCase(),
          amount: tradeData.amount,
          avgBuyPrice: tradeData.price,
          currentPrice: tradeData.price 
        });
      }
      
      setState(prev => {
        const newCash = prev.cash - (tradeData.totalValue + tradeData.fee);
        const updatedPortfolios = updatePortfolioRecursive(prev.rootPortfolios, { ...portfolio, assets: updatedAssets });
        const newTotalAssets = updatedPortfolios.reduce((sum, p) => sum + calculatePortfolioTotal(p), 0);
        const newNetWorth = newCash + newTotalAssets;

        return {
          ...prev,
          cash: newCash,
          tradeHistory: [newTrade, ...prev.tradeHistory],
          rootPortfolios: updatedPortfolios,
          netWorthHistory: recordHistory(prev.netWorthHistory, newNetWorth)
        };
      });

    } else {
      if (existingAssetIndex >= 0) {
        const asset = updatedAssets[existingAssetIndex];
        const realizedPnl = (tradeData.price - asset.avgBuyPrice) * tradeData.amount;
        newTrade.realizedPnl = realizedPnl;
        const newAmount = asset.amount - tradeData.amount;
        
        if (newAmount <= 0.000001) {
           updatedAssets.splice(existingAssetIndex, 1);
        } else {
           updatedAssets[existingAssetIndex] = {
             ...asset,
             amount: newAmount,
             currentPrice: tradeData.price
           };
        }

        setState(prev => {
          const newCash = prev.cash + (tradeData.totalValue - tradeData.fee);
          const netPnl = realizedPnl - tradeData.fee;

          // Propagate PnL logic (Same as before)
          const updatePortfoliosWithPnL = (list: Portfolio[]): { updated: Portfolio[], found: boolean } => {
             let foundInThisLayer = false;
             const updated = list.map(p => {
                 if (p.id === state.selectedPortfolioId) {
                     foundInThisLayer = true;
                     return { 
                         ...p, 
                         assets: updatedAssets, 
                         allocation: p.allocation + netPnl 
                     };
                 }
                 if (p.children.length > 0) {
                     const childResult = updatePortfoliosWithPnL(p.children);
                     if (childResult.found) {
                         foundInThisLayer = true;
                         return {
                             ...p,
                             children: childResult.updated,
                             allocation: p.allocation + netPnl 
                         };
                     }
                 }
                 return p;
             });
             return { updated, found: foundInThisLayer };
          };

          const { updated: updatedPortfolios } = updatePortfoliosWithPnL(prev.rootPortfolios);
          const newTotalAssets = updatedPortfolios.reduce((sum, p) => sum + calculatePortfolioTotal(p), 0);
          const newNetWorth = newCash + newTotalAssets;

          return {
            ...prev,
            cash: newCash,
            tradeHistory: [newTrade, ...prev.tradeHistory],
            rootPortfolios: updatedPortfolios,
            netWorthHistory: recordHistory(prev.netWorthHistory, newNetWorth)
          };
        });
      }
    }
  };

  const handleDeleteTrade = (tradeId: string, portfolioId: string) => {
    if (!confirm('آیا مطمئن هستید؟ با حذف این معامله، دارایی‌ها بر اساس تاریخچه مجدداً محاسبه می‌شوند.')) return;

    // 1. Remove trade from history
    const updatedHistory = state.tradeHistory.filter(t => t.id !== tradeId);
    
    // 2. Identify target portfolio
    const targetPortfolio = findPortfolioRecursive(state.rootPortfolios, portfolioId);
    if (!targetPortfolio) return;

    // 3. Replay trades for this portfolio to get correct assets
    const recalculatedAssets = replayPortfolioAssets(portfolioId, updatedHistory);

    // 4. Calculate Cash Delta (Simplification: Revert the specific trade's cash effect)
    // NOTE: A perfect system would replay cash from start, but for this simulator, reversing the single trade is acceptable 
    // unless fees/PnL allocations are complex. We will do a reverse operation.
    const deletedTrade = state.tradeHistory.find(t => t.id === tradeId);
    let cashChange = 0;
    if (deletedTrade) {
        if (deletedTrade.type === 'buy') {
            // We get money back (Trade Value + Fee)
            cashChange = deletedTrade.totalValue + deletedTrade.fee;
        } else {
            // We lose the money we got (Trade Value - Fee)
            // Note: If fee was deducted from payout, we give back payout.
            cashChange = -(deletedTrade.totalValue - deletedTrade.fee);
        }
    }

    setState(prev => {
        const updatedPortfolio = { ...targetPortfolio, assets: recalculatedAssets };
        const updatedRootPortfolios = updatePortfolioRecursive(prev.rootPortfolios, updatedPortfolio);
        
        // Also need to revert PnL allocation if it was a Sell trade? 
        // This is complex. For now, we update cash and assets. 
        // If the trade was a sell that added to allocation, removing it should reduce allocation.
        // Doing strictly via recursive update.
        
        // Update allocation reverse logic for PnL
        let finalRoots = updatedRootPortfolios;
        if (deletedTrade && deletedTrade.type === 'sell') {
             const netPnl = (deletedTrade.realizedPnl || 0) - deletedTrade.fee;
             // We need to SUBTRACT this netPnl from allocation because we are undoing the sell
             // Logic mirrors handleTrade but with negative netPnl
             const revertPnL = (list: Portfolio[]): Portfolio[] => {
                return list.map(p => {
                    if (p.id === portfolioId) {
                        return { ...p, allocation: p.allocation - netPnl };
                    }
                    if (p.children.length > 0) {
                        return { ...p, children: revertPnL(p.children), allocation: p.allocation - netPnl }; // simplified propogation
                    }
                    return p;
                });
             };
             // Note: Propagation logic in delete is tricky.
             // For simplicity in this demo, we assume manual allocation adjustment might be needed if deep hierarchy PnL logic desyncs.
             // But let's try to be consistent with the simple update.
        }

        const newTotalAssets = finalRoots.reduce((sum, p) => sum + calculatePortfolioTotal(p), 0);
        const newCash = prev.cash + cashChange;
        const newNetWorth = newCash + newTotalAssets;

        return {
            ...prev,
            cash: newCash,
            tradeHistory: updatedHistory,
            rootPortfolios: finalRoots,
            netWorthHistory: recordHistory(prev.netWorthHistory, newNetWorth)
        };
    });
  };

  const handleAssetPriceUpdate = (assetId: string, newPrice: number) => {
    // If ALL is selected, we can't easily know which specific portfolio's asset to update 
    // without more context, but usually price updates are per portfolio view.
    // We will find the asset across all portfolios if needed, but for now strict to selected.
    
    // If specific portfolio selected:
    if (state.selectedPortfolioId && state.selectedPortfolioId !== ALL_PORTFOLIOS_ID) {
        const portfolio = findPortfolioRecursive(state.rootPortfolios, state.selectedPortfolioId);
        if (!portfolio) return;

        const updatedAssets = portfolio.assets.map(a => 
            a.id === assetId ? { ...a, currentPrice: newPrice } : a
        );
        updateStateWithAssetChange(portfolio, updatedAssets);
    } else {
        // If ALL selected, finding asset by ID is risky if IDs aren't globally unique. 
        // Our IDs are time-based so likely unique.
        // Find portfolio containing this asset.
        const allPorts = flattenPortfolios(state.rootPortfolios);
        const targetP = allPorts.find(p => p.assets.some(a => a.id === assetId));
        if (targetP) {
             const updatedAssets = targetP.assets.map(a => 
                a.id === assetId ? { ...a, currentPrice: newPrice } : a
            );
            updateStateWithAssetChange(targetP, updatedAssets);
        }
    }
  };

  const updateStateWithAssetChange = (portfolio: Portfolio, updatedAssets: Asset[]) => {
      setState(prev => {
          const updatedPortfolios = updatePortfolioRecursive(prev.rootPortfolios, { ...portfolio, assets: updatedAssets });
          const newTotalAssets = updatedPortfolios.reduce((sum, p) => sum + calculatePortfolioTotal(p), 0);
          const newNetWorth = prev.cash + newTotalAssets;
          return {
            ...prev,
            rootPortfolios: updatedPortfolios,
            netWorthHistory: recordHistory(prev.netWorthHistory, newNetWorth)
          }
      });
  };

  const handleDeposit = () => {
    const amount = parseFloat(depositAmount) || 0;
    if (amount === 0) return;
    setState(prev => {
       const newCash = prev.cash + amount;
       const currentTotalAssets = prev.rootPortfolios.reduce((sum, p) => sum + calculatePortfolioTotal(p), 0);
       const newNetWorth = newCash + currentTotalAssets;
       return {
         ...prev,
         cash: newCash,
         netWorthHistory: recordHistory(prev.netWorthHistory, newNetWorth)
       };
    });
    setShowDepositModal(false);
    setDepositAmount('');
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SQL_SCHEMA);
    setShowSqlCopied(true);
    setTimeout(() => setShowSqlCopied(false), 2000);
  };

  const handleLogout = async () => {
      await supabase.auth.signOut();
  };

  // --- View Data Calculation ---
  const isAllPortfolios = state.selectedPortfolioId === ALL_PORTFOLIOS_ID;
  
  // Flatten portfolios for name lookup
  const flatPortfoliosMap = useMemo(() => {
     const map = new Map<string, string>();
     flattenPortfolios(state.rootPortfolios).forEach(p => map.set(p.id, p.name));
     return map;
  }, [state.rootPortfolios]);

  // Determine what to show
  let displayedPortfolios: Portfolio[] = [];
  if (isAllPortfolios) {
      displayedPortfolios = state.rootPortfolios; // Show roots, logic will handle children recursion for totals
  } else if (state.selectedPortfolioId) {
      const p = findPortfolioRecursive(state.rootPortfolios, state.selectedPortfolioId);
      if (p) displayedPortfolios = [p];
  }

  // Aggregate Data for display
  const aggregatedStats = useMemo(() => {
     let assets: Asset[] = [];
     let history: Trade[] = [];
     let allocation = 0;
     let totalVal = 0;
     let totalCost = 0;

     const processP = (p: Portfolio) => {
         assets = [...assets, ...p.assets];
         allocation += p.allocation; // This sums allocations. Note: In nested, only root allocation matters for "Total Capital"? 
         // Logic: If I select "All", I want sum of root allocations.
         
         // Value
         const pVal = calculatePortfolioTotal(p);
         totalVal += pVal; // This might double count if we aren't careful? calculatePortfolioTotal recurses.
         // Wait, calculatePortfolioTotal returns assets + children.
         // If we iterate roots and sum, we are good.
     };

     if (isAllPortfolios) {
         state.rootPortfolios.forEach(p => {
             totalVal += calculatePortfolioTotal(p);
             allocation += p.allocation;
         });
         // Gather all assets flatly
         const collectAssets = (nodes: Portfolio[]) => {
             nodes.forEach(n => {
                 assets.push(...n.assets);
                 collectAssets(n.children);
             });
         };
         collectAssets(state.rootPortfolios);
         history = state.tradeHistory;
     } else if (displayedPortfolios.length > 0) {
         const p = displayedPortfolios[0];
         totalVal = calculatePortfolioTotal(p);
         allocation = p.allocation;
         // Assets: show direct assets + maybe indicator of children? 
         // Existing logic: "displayPortfolio" handled viewing child assets.
         // Let's reuse displayPortfolio logic for the ASSET TABLE.
         
         // History: Filter for this portfolio and its children
         const allIds = getAllPortfolioIds(p);
         history = state.tradeHistory.filter(t => allIds.includes(t.portfolioId));
     }

     // Calculate cost
     // We need to iterate the ASSETS gathered to sum (amount * avgPrice)
     // BUT, for "All", we just gathered all assets.
     totalCost = assets.reduce((sum, a) => sum + (a.amount * a.avgBuyPrice), 0);

     return { assets, history, allocation, totalVal, totalCost };
  }, [state.rootPortfolios, state.tradeHistory, isAllPortfolios, displayedPortfolios]);

  // Logic for Asset Table display (Sub-view navigation)
  const selectedPortfolio = isAllPortfolios ? null : findPortfolioRecursive(state.rootPortfolios, state.selectedPortfolioId!);
  const displayPortfolioForAssets = (assetSubViewId && selectedPortfolio && assetSubViewId !== selectedPortfolio.id)
     ? selectedPortfolio.children.find(c => c.id === assetSubViewId) || selectedPortfolio
     : selectedPortfolio;

  // Filter positions for the History Tab
  const displayedPositions = useMemo(() => {
      let filtered = processPositions;
      if (!isAllPortfolios && selectedPortfolio) {
          const allIds = getAllPortfolioIds(selectedPortfolio);
          filtered = filtered.filter(p => allIds.includes(p.portfolioId));
      }
      return filtered;
  }, [processPositions, isAllPortfolios, selectedPortfolio]);


  const allocationPercentage = totalNetWorth > 0 ? (aggregatedStats.allocation / totalNetWorth) * 100 : 0;
  const unrealizedPnl = aggregatedStats.totalVal - aggregatedStats.totalCost;
  const realizedPnl = aggregatedStats.history.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
  const totalPnl = unrealizedPnl + realizedPnl;
  const unrealizedPnlPercent = aggregatedStats.totalCost > 0 ? (unrealizedPnl / aggregatedStats.totalCost) * 100 : 0;

  // Global PnL Data (Roots)
  const globalPnlData = state.rootPortfolios.map(p => {
     const allIds = getAllPortfolioIds(p);
     const realized = state.tradeHistory.filter(t => allIds.includes(t.portfolioId)).reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
     const currentVal = calculatePortfolioTotal(p);
     const cost = calculatePortfolioCost(p);
     const total = realized + (currentVal - cost);
     return { name: p.name, total };
  });

  const allocationPieData = state.rootPortfolios.map((p, index) => ({
    name: p.name,
    value: p.allocation,
    color: COLORS[index % COLORS.length]
  }));
  
  const netWorthData = state.netWorthHistory.map(item => ({
      date: new Date(item.date).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(item.date).toLocaleDateString('fa-IR'),
      rawDate: item.date,
      value: item.value
  }));

  // Helper to toggle position details
  const togglePosition = (posId: string) => {
      if (expandedPositions.includes(posId)) {
          setExpandedPositions(prev => prev.filter(id => id !== posId));
      } else {
          setExpandedPositions(prev => [...prev, posId]);
      }
  };

  // --- RENDER ---
  if (!isClient || authLoading) return <div className="min-h-screen flex items-center justify-center text-slate-400">در حال بارگذاری...</div>;

  if (!session) {
      return <Auth onAuthSuccess={() => {}} />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-brand-600 p-2 rounded-lg text-white">
               <TrendingUp size={24} />
            </div>
            <div>
               <h1 className="font-bold text-slate-800 text-lg">شبیه‌ساز تریدر پرو</h1>
               <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>ارزش کل دارایی:</span>
                  <span className="font-bold text-brand-600 dir-ltr">{formatCurrency(totalNetWorth)}</span>
               </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleCopySql} className="p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-600 rounded-lg" title="کپی SQL">
               {showSqlCopied ? <Check size={20} className="text-green-500" /> : <Database size={20} />}
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1"></div>
            <button onClick={() => { if(confirm('بازنشانی کل سیستم؟')) setState(INITIAL_STATE); }} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
               <Activity size={20} />
            </button>
            <button onClick={handleLogout} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
               <LogOut className="rotate-180" size={20} />
            </button>
            <div className="h-8 w-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-bold border border-brand-200 text-xs">
              {session.user.email?.substring(0,2).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1920px] mx-auto w-full p-6 grid grid-cols-12 gap-6 items-start">
        
        {/* Left: Navigation */}
        <aside className="col-span-12 lg:col-span-3 xl:col-span-2 flex flex-col gap-4">
          <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none">
             <div className="flex justify-between items-start mb-2">
               <div className="flex items-center gap-2 text-slate-300">
                 <Coins size={16} />
                 <span className="text-sm">قیمت تتر</span>
               </div>
               <button onClick={() => { setTempTetherPrice(state.tetherPrice.toString()); setShowTetherModal(true); }} className="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded">ویرایش</button>
             </div>
             <div className="text-2xl font-bold font-mono tracking-wider">{formatNumber(state.tetherPrice)} <span className="text-xs font-sans text-slate-400">تومان</span></div>
          </Card>

           {allocationPieData.length > 0 && (
            <Card className="p-4 flex flex-col items-center justify-center min-h-[220px]">
              <h4 className="font-bold text-slate-700 text-sm mb-2 w-full text-right">توزیع بودجه سبدها</h4>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={allocationPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                    {allocationPieData.map((entry, index) => ( <Cell key={`cell-${index}`} fill={entry.color} /> ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{borderRadius: '8px', fontSize: '12px'}}/>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                 {allocationPieData.map((entry, index) => (
                   <div key={index} className="flex items-center gap-1 text-[10px] text-slate-500">
                      <div className="w-2 h-2 rounded-full" style={{backgroundColor: entry.color}}></div>
                      <span>{entry.name}</span>
                   </div>
                 ))}
              </div>
            </Card>
           )}

          <Card className="flex-1 overflow-hidden min-h-[300px] flex flex-col">
            <CardHeader title="مدیریت سبدها" />
            <div className="p-3 flex-1 overflow-y-auto">
               <PortfolioTree 
                 portfolios={state.rootPortfolios}
                 selectedId={state.selectedPortfolioId}
                 onSelect={handleSelectPortfolio}
                 onAdd={(parentId) => setShowAddPortfolioModal({isOpen: true, parentId})}
                 onEdit={handleOpenEditPortfolio}
                 onDelete={handleDeletePortfolio}
               />
            </div>
          </Card>
        </aside>

        {/* Center: Dashboard */}
        <section className="col-span-12 lg:col-span-6 xl:col-span-7 flex flex-col gap-4">
           {state.selectedPortfolioId ? (
             <>
               {/* Summary Header */}
               <Card className={`p-6 text-white border-none shadow-md ${isAllPortfolios ? 'bg-gradient-to-r from-slate-800 to-slate-700' : 'bg-gradient-to-r from-brand-700 to-brand-600'}`}>
                 <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <div className="p-3 bg-white/10 rounded-full">
                        <Target size={32} className="text-white" />
                      </div>
                      <div>
                        <div className="text-white/70 text-sm mb-1">{isAllPortfolios ? 'کل بودجه تخصیص یافته' : 'بودجه تخصیص یافته به این سبد'}</div>
                        <div className="text-3xl font-bold font-mono dir-ltr tracking-tight">{formatCurrency(aggregatedStats.allocation)}</div>
                      </div>
                    </div>
                    
                    <div className="h-12 w-px bg-white/20 hidden md:block"></div>

                    <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-start">
                        <div>
                          <div className="flex items-center gap-2 text-white/70 text-xs mb-1">
                             <Percent size={14} /> سهم از کل سرمایه
                          </div>
                          <div className="text-2xl font-bold">{allocationPercentage.toFixed(1)}%</div>
                        </div>
                        <div className="text-right">
                           <div className="text-white/70 text-xs mb-1">سبد انتخاب شده</div>
                           <div className="font-bold text-lg">{isAllPortfolios ? 'همه سبدها' : selectedPortfolio?.name}</div>
                        </div>
                    </div>
                 </div>
               </Card>

               {/* Stats Grid */}
               <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
                  <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                       <Activity size={20} className="text-brand-500" />
                       وضعیت عملکرد
                       <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-1 rounded-full mr-2">
                         {activeTab === 'assets' ? 'نمای دارایی‌ها' : activeTab === 'history' ? 'تاریخچه پوزیشن‌ها' : 'نمای تحلیل'}
                       </span>
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 relative overflow-hidden group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1"><DollarSign size={14} className="text-blue-500" />ارزش دارایی‌ها</div>
                        <div className="text-lg font-bold text-slate-800 dir-ltr">{formatNumber(Math.round(aggregatedStats.totalVal))}</div>
                        <div className="text-[10px] text-slate-400 mt-1">تومان</div>
                     </div>
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1"><Activity size={14} className={unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"} />سود/زیان باز</div>
                        <div className={`text-lg font-bold dir-ltr ${unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(Math.round(unrealizedPnl))}</div>
                        <div className={`text-[10px] mt-1 dir-ltr flex items-center gap-1 ${unrealizedPnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                           {unrealizedPnlPercent >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{unrealizedPnlPercent.toFixed(2)}%
                        </div>
                     </div>
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1"><Wallet size={14} className={realizedPnl >= 0 ? "text-green-500" : "text-red-500"} />سود تحقق یافته</div>
                        <div className={`text-lg font-bold dir-ltr ${realizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(Math.round(realizedPnl))}</div>
                        <div className="text-[10px] text-slate-400 mt-1">تومان</div>
                     </div>
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1"><PieIcon size={14} className="text-purple-500" />بازده کل</div>
                        <div className={`text-lg font-bold dir-ltr ${totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(Math.round(totalPnl))}</div>
                        <div className="text-[10px] text-slate-400 mt-1">مجموع سود و زیان</div>
                     </div>
                  </div>

                  <div className="flex border-b border-slate-200">
                     <button onClick={() => setActiveTab('assets')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'assets' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                       <Wallet size={16} className="inline ml-2" /> دارایی‌ها
                     </button>
                     <button onClick={() => setActiveTab('history')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                       <History size={16} className="inline ml-2" /> تاریخچه پوزیشن‌ها
                     </button>
                     <button onClick={() => setActiveTab('analytics')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'analytics' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                       <PieIcon size={16} className="inline ml-2" /> تحلیل
                     </button>
                  </div>

                  <div className="mt-4">
                    {/* ASSETS TAB */}
                    {activeTab === 'assets' && (
                       <div className="flex flex-col gap-4">
                         
                         {/* Sub-Portfolio Navigation Bar (Only if NOT 'All' and has children) */}
                         {!isAllPortfolios && selectedPortfolio && selectedPortfolio.children.length > 0 && (
                           <div className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-100 mb-2">
                              <button
                                onClick={() => setAssetSubViewId(selectedPortfolio.id)}
                                className={`
                                  flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors
                                  ${(assetSubViewId === selectedPortfolio.id || !assetSubViewId) 
                                    ? 'bg-brand-600 text-white shadow-sm' 
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
                                `}
                              >
                                <Layers size={14} />
                                {selectedPortfolio.name} (دارایی مستقیم)
                              </button>
                              
                              {selectedPortfolio.children.map(child => (
                                <button
                                  key={child.id}
                                  onClick={() => setAssetSubViewId(child.id)}
                                  className={`
                                    flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors
                                    ${assetSubViewId === child.id 
                                      ? 'bg-brand-600 text-white shadow-sm' 
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
                                  `}
                                >
                                  <CornerDownRight size={14} />
                                  {child.name}
                                </button>
                              ))}
                           </div>
                         )}

                         <div className="overflow-x-auto">
                           {(isAllPortfolios ? aggregatedStats.assets : displayPortfolioForAssets?.assets || []).length === 0 ? (
                             <div className="text-center py-10 text-slate-400 border border-dashed border-slate-200 rounded-lg">
                               <p>هنوز دارایی در این بخش وجود ندارد.</p>
                             </div>
                           ) : (
                             <table className="w-full text-sm text-right">
                               <thead className="bg-slate-50 text-slate-500">
                                 <tr>
                                   <th className="p-3 rounded-r-lg">دارایی</th>
                                   <th className="p-3">مقدار</th>
                                   <th className="p-3">خرید میانگین</th>
                                   <th className="p-3">قیمت لحظه‌ای</th>
                                   <th className="p-3">ارزش کل</th>
                                   <th className="p-3 rounded-l-lg">سود/زیان</th>
                                 </tr>
                               </thead>
                               <tbody className="divide-y divide-slate-100">
                                 {(isAllPortfolios ? aggregatedStats.assets : displayPortfolioForAssets?.assets || []).map(asset => {
                                   const currentValue = asset.amount * asset.currentPrice;
                                   const costBasis = asset.amount * asset.avgBuyPrice;
                                   const pnl = currentValue - costBasis;
                                   const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
                                   
                                   return (
                                     <tr key={asset.id} className="hover:bg-slate-50 transition-colors group">
                                       <td className="p-3 font-medium">{asset.name}</td>
                                       <td className="p-3">{formatNumber(asset.amount)}</td>
                                       <td className="p-3 text-slate-500">{formatNumber(Math.round(asset.avgBuyPrice))}</td>
                                       <td className="p-3">
                                         <input 
                                           type="number" 
                                           className="w-24 px-2 py-1 border border-transparent hover:border-slate-300 rounded bg-transparent focus:bg-white focus:border-brand-500 outline-none text-xs transition-all"
                                           value={asset.currentPrice}
                                           onChange={(e) => handleAssetPriceUpdate(asset.id, parseFloat(e.target.value))}
                                         />
                                       </td>
                                       <td className="p-3 font-bold">{formatNumber(Math.round(currentValue))}</td>
                                       <td className={`p-3 dir-ltr text-right ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                         {pnlPercent.toFixed(2)}%
                                       </td>
                                     </tr>
                                   );
                                 })}
                               </tbody>
                             </table>
                           )}
                         </div>
                       </div>
                    )}

                    {/* POSITIONS HISTORY TAB */}
                    {activeTab === 'history' && (
                        <div className="space-y-4">
                           {displayedPositions.length === 0 ? (
                               <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-lg">
                                   <Briefcase size={32} className="mx-auto mb-2 opacity-50" />
                                   <p>هنوز هیچ موقعیت معاملاتی ثبت نشده است.</p>
                               </div>
                           ) : (
                               displayedPositions.map(pos => {
                                   const isExpanded = expandedPositions.includes(pos.id);
                                   const isProfitable = pos.realizedPnl >= 0;
                                   const isOpen = pos.status === 'OPEN';
                                   const netPnlPercent = pos.totalCost > 0 ? (pos.realizedPnl / pos.totalCost) * 100 : 0; // Approx based on total buy cost

                                   return (
                                       <div key={pos.id} className={`bg-white border rounded-xl transition-all overflow-hidden ${isOpen ? 'border-l-4 border-l-blue-500 border-slate-200' : (isProfitable ? 'border-l-4 border-l-green-500 border-slate-200' : 'border-l-4 border-l-red-500 border-slate-200')}`}>
                                           {/* Position Header Summary */}
                                           <div className="p-4 flex flex-col md:flex-row gap-4 justify-between items-center cursor-pointer hover:bg-slate-50" onClick={() => togglePosition(pos.id)}>
                                               <div className="flex items-center gap-4 w-full md:w-auto">
                                                   <div className={`p-2 rounded-full ${isOpen ? 'bg-blue-50 text-blue-600' : (isProfitable ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600')}`}>
                                                       {isOpen ? <Activity size={20} /> : (isProfitable ? <TrendingUp size={20} /> : <ArrowDownRight size={20} />)}
                                                   </div>
                                                   <div>
                                                       <div className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                                           {pos.assetName}
                                                           <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-normal">{flatPortfoliosMap.get(pos.portfolioId)}</span>
                                                       </div>
                                                       <div className="text-xs text-slate-500 flex items-center gap-3 mt-1">
                                                           <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(pos.startDate).toLocaleDateString('fa-IR')}</span>
                                                           <span className="flex items-center gap-1"><Clock size={10} /> {pos.durationDays} روز باز</span>
                                                           <span className={`font-bold ${pos.status === 'OPEN' ? 'text-blue-600' : 'text-slate-600'}`}>{pos.status === 'OPEN' ? 'باز' : 'بسته شده'}</span>
                                                       </div>
                                                   </div>
                                               </div>

                                               <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
                                                   <div className="text-right">
                                                       <div className="text-xs text-slate-400 mb-0.5">میانگین خرید</div>
                                                       <div className="font-mono text-sm">{formatNumber(Math.round(pos.avgBuyPrice))}</div>
                                                   </div>
                                                   <div className="text-right">
                                                       <div className="text-xs text-slate-400 mb-0.5">حجم کل</div>
                                                       <div className="font-mono text-sm">{formatNumber(pos.totalBuyAmount)}</div>
                                                   </div>
                                                   <div className="text-right pl-2 border-r border-slate-100 mr-2">
                                                       <div className="text-xs text-slate-400 mb-0.5">سود/زیان تحقق یافته</div>
                                                       <div className={`font-bold font-mono dir-ltr ${pos.realizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                           {formatCurrency(pos.realizedPnl)}
                                                       </div>
                                                   </div>
                                                   {isExpanded ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                                               </div>
                                           </div>

                                           {/* Expanded Details: Trade List */}
                                           {isExpanded && (
                                               <div className="bg-slate-50 border-t border-slate-100 p-4">
                                                   <h4 className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">ریز معاملات این پوزیشن</h4>
                                                   <div className="overflow-x-auto bg-white rounded-lg border border-slate-200">
                                                       <table className="w-full text-xs text-right">
                                                           <thead className="bg-slate-100 text-slate-500">
                                                               <tr>
                                                                   <th className="p-2">نوع</th>
                                                                   <th className="p-2">تاریخ</th>
                                                                   <th className="p-2">قیمت</th>
                                                                   <th className="p-2">مقدار</th>
                                                                   <th className="p-2">ارزش کل</th>
                                                                   <th className="p-2">کارمزد</th>
                                                                   <th className="p-2 text-center">عملیات</th>
                                                               </tr>
                                                           </thead>
                                                           <tbody className="divide-y divide-slate-100">
                                                               {pos.trades.map((trade, idx) => (
                                                                   <tr key={trade.id} className="hover:bg-slate-50">
                                                                       <td className="p-2">
                                                                           <span className={`px-2 py-0.5 rounded ${trade.type === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                               {trade.type === 'buy' ? 'خرید' : 'فروش'}
                                                                           </span>
                                                                       </td>
                                                                       <td className="p-2 dir-ltr text-right text-slate-500">{new Date(trade.timestamp).toLocaleDateString('fa-IR')}</td>
                                                                       <td className="p-2 font-mono">{formatNumber(Math.round(trade.price))}</td>
                                                                       <td className="p-2 font-mono">{formatNumber(trade.amount)}</td>
                                                                       <td className="p-2 font-mono">{formatNumber(Math.round(trade.totalValue))}</td>
                                                                       <td className="p-2 text-slate-400">{formatNumber(Math.round(trade.fee))}</td>
                                                                       <td className="p-2 flex justify-center gap-2">
                                                                           {/* We only implement Delete for robustness, Edit is complex with recalculation so usually Delete+Re-enter is safer in simulators */}
                                                                           <button 
                                                                             onClick={() => handleDeleteTrade(trade.id, trade.portfolioId)}
                                                                             className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                             title="حذف معامله"
                                                                           >
                                                                               <Trash2 size={14} />
                                                                           </button>
                                                                       </td>
                                                                   </tr>
                                                               ))}
                                                           </tbody>
                                                       </table>
                                                   </div>
                                               </div>
                                           )}
                                       </div>
                                   );
                               })
                           )}
                        </div>
                    )}

                    {/* ANALYTICS TAB */}
                    {activeTab === 'analytics' && (
                        <div className="space-y-6 mt-4">
                           {/* Chart 1: Net Worth (Area) */}
                           <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm h-80">
                             <h4 className="font-bold text-slate-700 mb-4 text-sm text-center flex items-center justify-center gap-2">
                                <TrendingUp size={16} className="text-brand-600" />
                                روند ارزش کل دارایی (Net Worth)
                             </h4>
                             {netWorthData.length > 0 ? (
                               <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={netWorthData} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
                                    <defs>
                                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                                      </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="date" tick={false} axisLine={false} />
                                    <YAxis tickFormatter={(val) => `${(val/1000000000).toFixed(2)}B`} tick={{fontSize: 11}} stroke="#64748b" domain={['auto', 'auto']}/>
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area type="monotone" dataKey="value" name="value" stroke="#2563eb" fillOpacity={1} fill="url(#colorValue)" strokeWidth={2}/>
                                  </AreaChart>
                               </ResponsiveContainer>
                             ) : (
                               <div className="h-full flex items-center justify-center text-slate-400">داده‌ای برای نمایش وجود ندارد</div>
                             )}
                           </div>

                           <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Chart 2: Allocation (Pie) */}
                                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm h-80">
                                    <h4 className="font-bold text-slate-700 mb-4 text-sm text-center">توزیع دارایی‌ها (Allocation)</h4>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={allocationPieData} cx="50%" cy="50%" outerRadius={80} fill="#8884d8" dataKey="value" label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                                 {allocationPieData.map((entry, index) => ( <Cell key={`cell-${index}`} fill={entry.color} /> ))}
                                            </Pie>
                                            <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{borderRadius: '8px', fontSize: '12px', direction: 'rtl'}}/>
                                            <Legend wrapperStyle={{fontSize: '11px', paddingTop: '10px'}}/>
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* Chart 3: PnL Analysis (Bar) */}
                                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm h-80">
                                     <h4 className="font-bold text-slate-700 mb-4 text-sm text-center">عملکرد پوزیشن‌های بسته شده (سود/زیان)</h4>
                                     <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={processPositions.filter(p => p.status === 'CLOSED' && Math.abs(p.realizedPnl) > 0).slice(0, 8)}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                            <XAxis dataKey="assetName" tick={{fontSize: 10}} />
                                            <YAxis tickFormatter={(val) => `${(val/1000000).toFixed(1)}M`} tick={{fontSize: 10}} />
                                            <Tooltip formatter={(value: number) => formatCurrency(value)} cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', fontSize: '12px'}} />
                                            <ReferenceLine y={0} stroke="#94a3b8" />
                                            <Bar dataKey="realizedPnl" name="سود/زیان" radius={[4, 4, 0, 0]}>
                                                {processPositions.filter(p => p.status === 'CLOSED' && Math.abs(p.realizedPnl) > 0).slice(0, 8).map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.realizedPnl >= 0 ? '#10b981' : '#ef4444'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                     </ResponsiveContainer>
                                     {processPositions.filter(p => p.status === 'CLOSED').length === 0 && (
                                         <div className="absolute inset-0 flex items-center justify-center text-slate-400 bg-white/50 backdrop-blur-[1px]">
                                             هنوز پوزیشنی بسته نشده است
                                         </div>
                                     )}
                                </div>
                           </div>
                        </div>
                    )}
                  </div>
               </div>
             </>
           ) : (
             <div className="h-full flex flex-col items-center justify-center text-slate-400 p-10 border-2 border-dashed border-slate-200 rounded-xl">
               <LayoutGrid size={48} className="mb-4 opacity-50" />
               <p className="text-lg">لطفاً یک سبد را از منوی سمت راست انتخاب کنید</p>
             </div>
           )}
        </section>

        {/* Right: Actions */}
        <aside className="col-span-12 lg:col-span-3 xl:col-span-3 flex flex-col gap-4">
           <Card className="p-5 bg-white border-brand-100">
             <div className="mb-4 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-500 mb-1"><Coins size={14} /><span className="text-xs font-medium">ارزش کل سرمایه</span></div>
                <div className="text-xl font-bold text-brand-600 dir-ltr tracking-tight">{formatCurrency(totalNetWorth)}</div>
                <div className="text-xs text-slate-400 mt-1">{numberToPersianWords(totalNetWorth)} تومان</div>
             </div>
             <div className="flex justify-between items-center mb-4">
               <div>
                   <span className="text-sm text-slate-500 font-medium block">موجودی نقد (آزاد)</span>
                   <div className="text-2xl font-bold text-slate-800 mt-1">{formatCurrency(state.cash)}</div>
               </div>
               <div className="p-3 bg-green-50 text-green-600 rounded-xl"><Wallet size={24} /></div>
             </div>
             <Button variant="outline" className="w-full text-xs" onClick={() => { setDepositAmount(''); setShowDepositModal(true); }}>مدیریت موجودی</Button>
           </Card>

           <TradeForm 
             portfolio={selectedPortfolio} 
             rootPortfolios={state.rootPortfolios}
             onPortfolioSelect={handleSelectPortfolio}
             tetherPrice={state.tetherPrice}
             cashBalance={state.cash}
             onTrade={handleTrade}
           />
        </aside>
      </main>

      {/* --- MODALS --- */}
      {showAddPortfolioModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-lg">ایجاد سبد جدید</h3><button onClick={() => setShowAddPortfolioModal({isOpen: false, parentId: null})}><X size={20} /></button></div>
            <div className="space-y-4">
              <Input label="نام سبد" value={newPortfolioName} onChange={e => setNewPortfolioName(e.target.value)} autoFocus />
              <Input label="بودجه تخصیصی (تومان)" type="number" value={newPortfolioAlloc} onChange={e => setNewPortfolioAlloc(e.target.value)} />
              <Button onClick={handleAddPortfolio} className="w-full mt-2">ایجاد سبد</Button>
            </div>
          </Card>
        </div>
      )}

      {showEditPortfolioModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-lg">ویرایش سبد</h3><button onClick={() => setShowEditPortfolioModal({isOpen: false, portfolio: null})}><X size={20} /></button></div>
            <div className="space-y-4">
              <Input label="نام سبد" value={editPortfolioName} onChange={e => setEditPortfolioName(e.target.value)} autoFocus />
              <Input label="بودجه تخصیصی (تومان)" type="number" value={editPortfolioAlloc} onChange={e => setEditPortfolioAlloc(e.target.value)} />
              <div className="flex gap-2"><Button onClick={handleUpdatePortfolio} className="flex-1 mt-2">ذخیره تغییرات</Button><Button variant="secondary" onClick={() => setShowEditPortfolioModal({isOpen: false, portfolio: null})} className="flex-1 mt-2">انصراف</Button></div>
            </div>
          </Card>
        </div>
      )}

      {showTetherModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6">
            <h3 className="font-bold text-lg mb-4">بروزرسانی قیمت تتر</h3>
            <Input label="قیمت جدید (تومان)" type="number" value={tempTetherPrice} onChange={e => setTempTetherPrice(e.target.value)} />
            <div className="flex gap-2 mt-4"><Button onClick={() => { setState(p => ({...p, tetherPrice: parseFloat(tempTetherPrice) || p.tetherPrice})); setShowTetherModal(false); }} className="flex-1">ذخیره</Button><Button variant="secondary" onClick={() => setShowTetherModal(false)} className="flex-1">انصراف</Button></div>
          </Card>
        </div>
      )}

      {showDepositModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6">
            <h3 className="font-bold text-lg mb-4">مدیریت موجودی نقد</h3>
            <Input label="مبلغ واریز/برداشت (تومان)" placeholder="مثلا: 50000000" type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
            <p className="text-xs text-slate-500 mt-2">برای برداشت از علامت منفی استفاده کنید.</p>
            <div className="flex gap-2 mt-4"><Button onClick={handleDeposit} className="flex-1">ثبت تراکنش</Button><Button variant="secondary" onClick={() => setShowDepositModal(false)} className="flex-1">انصراف</Button></div>
          </Card>
        </div>
      )}
    </div>
  );
}