import React, { useState, useEffect, useCallback } from 'react';
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
  Copy
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

  // --- Auth & Data Loading Logic ---
  useEffect(() => {
    setIsClient(true);

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
      if (session) loadData(session.user.id);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
         loadData(session.user.id);
      } else {
         // Reset to initial state on logout, or keep local storage logic if desired.
         // For now, let's reset to ensure clean state
         setState(INITIAL_STATE);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (userId: string) => {
    try {
      // Try fetch from Supabase
      const { data, error } = await supabase
        .from('user_saves')
        .select('state')
        .eq('id', userId)
        .single();

      if (data && data.state) {
        // Migration check
        let loadedState = data.state;
         if (!loadedState.netWorthHistory || !Array.isArray(loadedState.netWorthHistory)) {
           const totalAssets = loadedState.rootPortfolios.reduce((sum: number, p: Portfolio) => sum + calculatePortfolioTotal(p), 0);
           loadedState.netWorthHistory = [{ date: new Date().toISOString(), value: loadedState.cash + totalAssets }];
        }
        setState(loadedState);
      } else {
        // No remote data, check local storage or init
        const saved = localStorage.getItem('traderSimState');
        if (saved) {
           // Optionally migrate local storage to supabase here
           const parsed = JSON.parse(saved);
           setState(parsed);
           // save to supabase immediately to sync
           saveDataToSupabase(userId, parsed);
        }
      }
    } catch (e) {
      console.error("Error loading data", e);
    } finally {
      setDataLoaded(true);
    }
  };

  // --- Data Saving Logic ---
  // Debounce save to Supabase
  useEffect(() => {
    if (!isClient || !session || !dataLoaded) return;

    // Save to LocalStorage always as backup/cache
    localStorage.setItem('traderSimState', JSON.stringify(state));

    const timeoutId = setTimeout(() => {
       saveDataToSupabase(session.user.id, state);
    }, 2000); // 2 seconds debounce

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

  // --- Handlers (Same as before) ---
  const recordHistory = (prevHistory: NetWorthSnapshot[], newNetWorth: number): NetWorthSnapshot[] => {
     return [...prevHistory, { date: new Date().toISOString(), value: newNetWorth }];
  };

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
    // Note: Advanced parent budget validation is skipped here for simplicity in this edit step, 
    // but in a real app, you would check if the new allocation fits within the parent's budget.

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

  const handleTrade = (tradeData: any) => {
    if (!state.selectedPortfolioId) return;
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
          
          // Calculate Net PnL (Realized Profit - Fee) to add to portfolio allocation
          // This allows purchasing power to grow with profits
          const netPnl = realizedPnl - tradeData.fee;

          // Recursive function to update portfolio tree and propagate PnL to allocations
          const updatePortfoliosWithPnL = (list: Portfolio[]): { updated: Portfolio[], found: boolean } => {
             let foundInThisLayer = false;
             const updated = list.map(p => {
                 // Check if this is the target portfolio
                 if (p.id === state.selectedPortfolioId) {
                     foundInThisLayer = true;
                     return { 
                         ...p, 
                         assets: updatedAssets, 
                         allocation: p.allocation + netPnl 
                     };
                 }
                 
                 // Check children
                 if (p.children.length > 0) {
                     const childResult = updatePortfoliosWithPnL(p.children);
                     if (childResult.found) {
                         foundInThisLayer = true;
                         return {
                             ...p,
                             children: childResult.updated,
                             allocation: p.allocation + netPnl // Propagate PnL up to ancestor
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

  const handleAssetPriceUpdate = (assetId: string, newPrice: number) => {
    if (!state.selectedPortfolioId) return;
    const portfolio = findPortfolioRecursive(state.rootPortfolios, state.selectedPortfolioId);
    if (!portfolio) return;

    const updatedAssets = portfolio.assets.map(a => 
      a.id === assetId ? { ...a, currentPrice: newPrice } : a
    );

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


  // --- View Data Variables ---
  const selectedPortfolio = state.selectedPortfolioId 
    ? findPortfolioRecursive(state.rootPortfolios, state.selectedPortfolioId) 
    : null;

  const currentPortfolioValue = selectedPortfolio ? calculatePortfolioTotal(selectedPortfolio) : 0;
  const portfolioAllocation = selectedPortfolio?.allocation || 0;
  const allocationPercentage = totalNetWorth > 0 ? (portfolioAllocation / totalNetWorth) * 100 : 0;
  const portfolioHistory = state.tradeHistory.filter(t => t.portfolioId === state.selectedPortfolioId);
  const portfolioAssets = selectedPortfolio?.assets || [];
  const totalAssetValueLocal = portfolioAssets.reduce((sum, a) => sum + (a.amount * a.currentPrice), 0);
  const totalCostBasis = portfolioAssets.reduce((sum, a) => sum + (a.amount * a.avgBuyPrice), 0);
  const unrealizedPnl = totalAssetValueLocal - totalCostBasis;
  const realizedPnl = portfolioHistory.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
  const totalPnl = unrealizedPnl + realizedPnl;
  const unrealizedPnlPercent = totalCostBasis > 0 ? (unrealizedPnl / totalCostBasis) * 100 : 0;

  // Generic PnL Calculation for any list of portfolios
  const getPnlDataForPortfolios = (portfolios: Portfolio[]) => {
    return portfolios.map(p => {
        const allIds = getAllPortfolioIds(p);
        const realized = state.tradeHistory
            .filter(t => allIds.includes(t.portfolioId))
            .reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
        const currentVal = calculatePortfolioTotal(p);
        const cost = calculatePortfolioCost(p);
        const unrealized = currentVal - cost;
        const total = realized + unrealized;
        const percentOfNetWorth = totalNetWorth > 0 ? (total / totalNetWorth) * 100 : 0;
        return { name: p.name, realized, unrealized, total, percent: percentOfNetWorth };
    });
  };

  // Global PnL Data (Roots)
  const globalPnlData = getPnlDataForPortfolios(state.rootPortfolios);

  // Sub-Portfolio PnL Data (Children of selected)
  const subPnlData = selectedPortfolio ? getPnlDataForPortfolios(selectedPortfolio.children) : [];
  
  // Pie Chart Data for Left Panel (Allocation Distribution)
  const allocationPieData = state.rootPortfolios.map((p, index) => ({
    name: p.name,
    value: p.allocation,
    color: COLORS[index % COLORS.length]
  }));
  
  // Add Unallocated Cash if needed for the pie chart context, but request said "Distribution based on portfolios".
  // Let's stick to just showing the breakdown of the Allocated Portfolios to make it clean "Portfolio Management" chart.

  const netWorthData = state.netWorthHistory.map(item => ({
      date: new Date(item.date).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(item.date).toLocaleDateString('fa-IR'),
      rawDate: item.date,
      value: item.value
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      if (payload[0].payload.percent !== undefined) {
         const data = payload[0].payload;
         return (
            <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-sm text-right">
              <p className="font-bold mb-2 text-slate-700">{label}</p>
              <div className="flex justify-between gap-4 mb-1 text-slate-600">
                  <span>سود/زیان کل:</span>
                  <span className={`font-mono dir-ltr ${data.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(data.total)}</span>
              </div>
              <div className="flex justify-between gap-4 mb-1 text-slate-600">
                  <span>درصد از کل سرمایه:</span>
                  <span className={`font-mono dir-ltr ${data.percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>{data.percent.toFixed(2)}%</span>
              </div>
            </div>
         );
      }
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-sm text-right">
          <p className="font-bold mb-2 text-slate-700">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-end gap-2 mb-1" style={{ color: entry.color }}>
              <span className="font-mono dir-ltr font-bold">{formatCurrency(entry.value)}</span>
              <span>: {entry.name === 'value' ? 'ارزش کل' : entry.name}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
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
            <button 
               onClick={handleCopySql}
               className="p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-600 rounded-lg transition-colors relative"
               title="کپی کردن SQL دیتابیس"
            >
               {showSqlCopied ? <Check size={20} className="text-green-500" /> : <Database size={20} />}
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1"></div>
            <button 
                onClick={() => {
                   if(confirm('آیا مطمئن هستید؟ تمام داده‌ها پاک می‌شوند.')) {
                       setState(INITIAL_STATE);
                   }
                }}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg" title="بازنشانی شبیه‌ساز">
               <Activity className="" size={20} />
            </button>
            <button 
                onClick={handleLogout}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="خروج از حساب">
               <LogOut className="rotate-180" size={20} />
            </button>
            <div className="h-8 w-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-bold border border-brand-200 text-xs">
              {session.user.email?.substring(0,2).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout - Expanded width and adjusted columns */}
      <main className="flex-1 max-w-[1920px] mx-auto w-full p-6 grid grid-cols-12 gap-6 items-start">
        
        {/* Left Panel: Navigation & Global Settings */}
        <aside className="col-span-12 lg:col-span-3 xl:col-span-2 flex flex-col gap-4">
          
          {/* Tether Price Card */}
          <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none">
             <div className="flex justify-between items-start mb-2">
               <div className="flex items-center gap-2 text-slate-300">
                 <Coins size={16} />
                 <span className="text-sm">قیمت تتر</span>
               </div>
               <button onClick={() => { setTempTetherPrice(state.tetherPrice.toString()); setShowTetherModal(true); }} className="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded transition">ویرایش</button>
             </div>
             <div className="text-2xl font-bold font-mono tracking-wider">{formatNumber(state.tetherPrice)} <span className="text-xs font-sans text-slate-400">تومان</span></div>
          </Card>

           {/* Capital Distribution Chart */}
           {allocationPieData.length > 0 && (
            <Card className="p-4 flex flex-col items-center justify-center min-h-[220px]">
              <h4 className="font-bold text-slate-700 text-sm mb-2 w-full text-right">توزیع بودجه سبدها</h4>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={allocationPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {allocationPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)} 
                    contentStyle={{borderRadius: '8px', fontSize: '12px'}}
                  />
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

          {/* Portfolios */}
          <Card className="flex-1 overflow-hidden min-h-[300px] flex flex-col">
            <CardHeader 
              title="مدیریت سبدها" 
            />
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

        {/* Center Panel: Dashboard - Made Wider (xl:col-span-8) */}
        <section className="col-span-12 lg:col-span-6 xl:col-span-7 flex flex-col gap-4">
           {selectedPortfolio ? (
             <>
               {/* Allocation Summary Card at the Top */}
               <Card className="p-6 bg-gradient-to-r from-brand-700 to-brand-600 text-white border-none shadow-md">
                 <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <div className="p-3 bg-white/10 rounded-full">
                        <Target size={32} className="text-white" />
                      </div>
                      <div>
                        <div className="text-brand-100 text-sm mb-1">بودجه تخصیص یافته به این سبد</div>
                        <div className="text-3xl font-bold font-mono dir-ltr tracking-tight">{formatCurrency(portfolioAllocation)}</div>
                      </div>
                    </div>
                    
                    <div className="h-12 w-px bg-white/20 hidden md:block"></div>

                    <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-start">
                        <div>
                          <div className="flex items-center gap-2 text-brand-100 text-xs mb-1">
                             <Percent size={14} /> سهم از کل سرمایه
                          </div>
                          <div className="text-2xl font-bold">{allocationPercentage.toFixed(1)}%</div>
                        </div>
                        <div className="text-right">
                           <div className="text-brand-100 text-xs mb-1">نام سبد</div>
                           <div className="font-bold text-lg">{selectedPortfolio.name}</div>
                        </div>
                    </div>
                 </div>
               </Card>

               {/* Portfolio Stats & Charts */}
               <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
                  {/* Title Row */}
                  <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                       <Activity size={20} className="text-brand-500" />
                       وضعیت عملکرد
                    </h2>
                  </div>

                  {/* 4 Summary Cards Grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                     {/* Card 1: Asset Value */}
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 relative overflow-hidden group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
                          <DollarSign size={14} className="text-blue-500" />
                          ارزش دارایی‌ها
                        </div>
                        <div className="text-lg font-bold text-slate-800 dir-ltr">{formatNumber(Math.round(totalAssetValueLocal))}</div>
                        <div className="text-[10px] text-slate-400 mt-1">تومان</div>
                     </div>

                     {/* Card 2: Unrealized P/L */}
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
                          <Activity size={14} className={unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"} />
                          سود/زیان باز
                        </div>
                        <div className={`text-lg font-bold dir-ltr ${unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                           {formatNumber(Math.round(unrealizedPnl))}
                        </div>
                        <div className={`text-[10px] mt-1 dir-ltr flex items-center gap-1 ${unrealizedPnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                           {unrealizedPnlPercent >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                           {unrealizedPnlPercent.toFixed(2)}%
                        </div>
                     </div>

                     {/* Card 3: Realized P/L */}
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
                           <Wallet size={14} className={realizedPnl >= 0 ? "text-green-500" : "text-red-500"} />
                           سود تحقق یافته
                        </div>
                        <div className={`text-lg font-bold dir-ltr ${realizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                           {formatNumber(Math.round(realizedPnl))}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">تومان</div>
                     </div>

                     {/* Card 4: Total P/L */}
                     <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 group hover:border-brand-200 transition-colors">
                        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
                           <PieIcon size={14} className="text-purple-500" />
                           بازده کل
                        </div>
                        <div className={`text-lg font-bold dir-ltr ${totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                           {formatNumber(Math.round(totalPnl))}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">مجموع سود و زیان</div>
                     </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-slate-200">
                     <button onClick={() => setActiveTab('assets')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'assets' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                       <Wallet size={16} className="inline ml-2" /> دارایی‌ها
                     </button>
                     <button onClick={() => setActiveTab('history')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                       <History size={16} className="inline ml-2" /> تاریخچه
                     </button>
                     <button onClick={() => setActiveTab('analytics')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'analytics' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                       <PieIcon size={16} className="inline ml-2" /> تحلیل
                     </button>
                  </div>

                  {/* Tab Content */}
                  <div className="mt-4">
                    {activeTab === 'assets' && (
                       <div className="overflow-x-auto">
                         {selectedPortfolio.assets.length === 0 ? (
                           <div className="text-center py-10 text-slate-400">هنوز دارایی در این سبد ندارید.</div>
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
                               {selectedPortfolio.assets.map(asset => {
                                 const currentValue = asset.amount * asset.currentPrice;
                                 const costBasis = asset.amount * asset.avgBuyPrice;
                                 const pnl = currentValue - costBasis;
                                 const pnlPercent = (pnl / costBasis) * 100;
                                 
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
                    )}

                    {activeTab === 'history' && (
                        <div className="overflow-x-auto">
                           <table className="w-full text-sm text-right">
                             <thead className="bg-slate-50 text-slate-500">
                               <tr>
                                 <th className="p-3">نوع</th>
                                 <th className="p-3">دارایی</th>
                                 <th className="p-3">قیمت</th>
                                 <th className="p-3">کل</th>
                                 <th className="p-3">زمان</th>
                               </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-100">
                               {portfolioHistory.map(trade => (
                                 <tr key={trade.id} className="hover:bg-slate-50">
                                   <td className="p-3">
                                     <span className={`px-2 py-0.5 rounded text-xs ${trade.type === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                       {trade.type === 'buy' ? 'خرید' : 'فروش'}
                                     </span>
                                   </td>
                                   <td className="p-3">{trade.assetName}</td>
                                   <td className="p-3">{formatNumber(Math.round(trade.price))}</td>
                                   <td className="p-3">{formatNumber(Math.round(trade.totalValue))}</td>
                                   <td className="p-3 text-slate-400 text-xs dir-ltr">{new Date(trade.timestamp).toLocaleDateString('fa-IR')}</td>
                                 </tr>
                               ))}
                             </tbody>
                           </table>
                        </div>
                    )}

                    {activeTab === 'analytics' && (
                        <div className="space-y-6 mt-4">
                           {/* Net Worth Chart Area */}
                           <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 h-80">
                             <h4 className="font-bold text-slate-700 mb-4 text-sm text-center flex items-center justify-center gap-2">
                                <TrendingUp size={16} className="text-brand-600" />
                                روند ارزش کل دارایی (Net Worth)
                             </h4>
                             {netWorthData.length > 0 ? (
                               <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart
                                    data={netWorthData}
                                    margin={{ top: 10, right: 30, left: 20, bottom: 0 }}
                                  >
                                    <defs>
                                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                                      </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="date" tick={false} axisLine={false} />
                                    <YAxis 
                                      tickFormatter={(val) => `${(val/1000000000).toFixed(2)}B`} 
                                      tick={{fontSize: 11}} 
                                      stroke="#64748b" 
                                      domain={['auto', 'auto']}
                                    />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area 
                                      type="monotone" 
                                      dataKey="value" 
                                      name="value"
                                      stroke="#2563eb" 
                                      fillOpacity={1} 
                                      fill="url(#colorValue)" 
                                      strokeWidth={2}
                                    />
                                  </AreaChart>
                               </ResponsiveContainer>
                             ) : (
                               <div className="h-full flex items-center justify-center text-slate-400">داده‌ای برای نمایش وجود ندارد</div>
                             )}
                           </div>

                           {/* GLOBAL PnL Bar Chart */}
                           <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 h-80">
                             <h4 className="font-bold text-slate-700 mb-4 text-sm text-center">مقایسه سود و زیان تمام سبدهای اصلی</h4>
                             {globalPnlData.length > 0 ? (
                               <ResponsiveContainer width="100%" height="100%">
                                   <BarChart
                                     data={globalPnlData}
                                     margin={{
                                       top: 5,
                                       right: 30,
                                       left: 20,
                                       bottom: 5,
                                     }}
                                   >
                                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                     <XAxis dataKey="name" tick={{fontSize: 12}} stroke="#64748b" />
                                     <YAxis tickFormatter={(val) => `${(val/1000000).toFixed(0)}M`} tick={{fontSize: 11}} stroke="#64748b" />
                                     <Tooltip content={<CustomTooltip />} />
                                     <ReferenceLine y={0} stroke="#94a3b8" />
                                     <Bar 
                                       dataKey="total" 
                                       name="سود/زیان کل" 
                                       radius={[4, 4, 0, 0]} 
                                       barSize={50}
                                     >
                                        {globalPnlData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={entry.total >= 0 ? '#10b981' : '#ef4444'} />
                                        ))}
                                     </Bar>
                                   </BarChart>
                               </ResponsiveContainer>
                             ) : (
                               <div className="h-full flex items-center justify-center text-slate-400">داده‌ای برای نمایش وجود ندارد</div>
                             )}
                           </div>

                           {/* SUB-PORTFOLIOS PnL Bar Chart */}
                           {subPnlData.length > 0 && (
                             <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 h-80 mt-6">
                               <h4 className="font-bold text-slate-700 mb-4 text-sm text-center">مقایسه سود و زیان زیرمجموعه‌ها</h4>
                               <ResponsiveContainer width="100%" height="100%">
                                   <BarChart
                                     data={subPnlData}
                                     margin={{
                                       top: 5,
                                       right: 30,
                                       left: 20,
                                       bottom: 5,
                                     }}
                                   >
                                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                     <XAxis dataKey="name" tick={{fontSize: 12}} stroke="#64748b" />
                                     <YAxis tickFormatter={(val) => `${(val/1000000).toFixed(0)}M`} tick={{fontSize: 11}} stroke="#64748b" />
                                     <Tooltip content={<CustomTooltip />} />
                                     <ReferenceLine y={0} stroke="#94a3b8" />
                                     <Bar 
                                       dataKey="total" 
                                       name="سود/زیان کل" 
                                       radius={[4, 4, 0, 0]} 
                                       barSize={50}
                                     >
                                        {subPnlData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={entry.total >= 0 ? '#10b981' : '#ef4444'} />
                                        ))}
                                     </Bar>
                                   </BarChart>
                               </ResponsiveContainer>
                             </div>
                           )}
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

        {/* Right Panel: Actions */}
        <aside className="col-span-12 lg:col-span-3 xl:col-span-3 flex flex-col gap-4">
           {/* Cash Card */}
           <Card className="p-5 bg-white border-brand-100">
             
             {/* Total Net Worth Section */}
             <div className="mb-4 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <Coins size={14} />
                    <span className="text-xs font-medium">ارزش کل سرمایه</span>
                </div>
                <div className="text-xl font-bold text-brand-600 dir-ltr tracking-tight">
                    {formatCurrency(totalNetWorth)}
                </div>
                <div className="text-xs text-slate-400 mt-1">{numberToPersianWords(totalNetWorth)} تومان</div>
             </div>

             {/* Liquid Cash Section */}
             <div className="flex justify-between items-center mb-4">
               <div>
                   <span className="text-sm text-slate-500 font-medium block">موجودی نقد (آزاد)</span>
                   <div className="text-2xl font-bold text-slate-800 mt-1">{formatCurrency(state.cash)}</div>
                   <div className="text-xs text-slate-400 mt-1">{numberToPersianWords(state.cash)} تومان</div>
               </div>
               <div className="p-3 bg-green-50 text-green-600 rounded-xl">
                 <Wallet size={24} />
               </div>
             </div>
             
             <Button variant="outline" className="w-full text-xs" onClick={() => { setDepositAmount(''); setShowDepositModal(true); }}>
               مدیریت موجودی
             </Button>
           </Card>

           {/* Trade Form */}
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
      
      {/* Add Portfolio Modal */}
      {showAddPortfolioModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">ایجاد سبد جدید</h3>
              <button onClick={() => setShowAddPortfolioModal({isOpen: false, parentId: null})}><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <Input label="نام سبد" value={newPortfolioName} onChange={e => setNewPortfolioName(e.target.value)} autoFocus />
              <Input label="بودجه تخصیصی (تومان)" type="number" value={newPortfolioAlloc} onChange={e => setNewPortfolioAlloc(e.target.value)} />
              <Button onClick={handleAddPortfolio} className="w-full mt-2">ایجاد سبد</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Portfolio Modal */}
      {showEditPortfolioModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">ویرایش سبد</h3>
              <button onClick={() => setShowEditPortfolioModal({isOpen: false, portfolio: null})}><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <Input label="نام سبد" value={editPortfolioName} onChange={e => setEditPortfolioName(e.target.value)} autoFocus />
              <Input label="بودجه تخصیصی (تومان)" type="number" value={editPortfolioAlloc} onChange={e => setEditPortfolioAlloc(e.target.value)} />
              <div className="flex gap-2">
                 <Button onClick={handleUpdatePortfolio} className="flex-1 mt-2">ذخیره تغییرات</Button>
                 <Button variant="secondary" onClick={() => setShowEditPortfolioModal({isOpen: false, portfolio: null})} className="flex-1 mt-2">انصراف</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Tether Price Modal */}
      {showTetherModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6">
            <h3 className="font-bold text-lg mb-4">بروزرسانی قیمت تتر</h3>
            <Input label="قیمت جدید (تومان)" type="number" value={tempTetherPrice} onChange={e => setTempTetherPrice(e.target.value)} />
            <div className="flex gap-2 mt-4">
              <Button onClick={() => { setState(p => ({...p, tetherPrice: parseFloat(tempTetherPrice) || p.tetherPrice})); setShowTetherModal(false); }} className="flex-1">ذخیره</Button>
              <Button variant="secondary" onClick={() => setShowTetherModal(false)} className="flex-1">انصراف</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6">
            <h3 className="font-bold text-lg mb-4">مدیریت موجودی نقد</h3>
            <Input label="مبلغ واریز/برداشت (تومان)" placeholder="مثلا: 50000000" type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
            <p className="text-xs text-slate-500 mt-2">برای برداشت از علامت منفی استفاده کنید.</p>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleDeposit} className="flex-1">ثبت تراکنش</Button>
              <Button variant="secondary" onClick={() => setShowDepositModal(false)} className="flex-1">انصراف</Button>
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}