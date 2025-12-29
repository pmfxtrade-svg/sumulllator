import React, { useState, useEffect } from 'react';
import { Asset, FeeType, TradeType, Portfolio } from '../types';
import { Card, CardHeader, Input, Button, formatCurrency, formatNumber } from './ui';
import { RefreshCw, Calculator, TrendingUp, TrendingDown, Wallet, FolderTree, ArrowRight } from 'lucide-react';

interface TradeFormProps {
  portfolio: Portfolio | null;
  rootPortfolios: Portfolio[];
  onPortfolioSelect: (id: string) => void;
  tetherPrice: number;
  cashBalance: number;
  onTrade: (tradeData: any) => void;
}

export const TradeForm: React.FC<TradeFormProps> = ({ 
  portfolio, 
  rootPortfolios,
  onPortfolioSelect,
  tetherPrice, 
  cashBalance, 
  onTrade 
}) => {
  const [type, setType] = useState<TradeType>('buy');
  const [assetName, setAssetName] = useState('');
  const [price, setPrice] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [total, setTotal] = useState<string>('');
  const [feeType, setFeeType] = useState<FeeType>('percentage');
  const [feeValue, setFeeValue] = useState<string>('0.2'); // Default 0.2%
  const [currency, setCurrency] = useState<'toman' | 'tether'>('toman');
  
  // To prevent circular updates
  const [lastEdited, setLastEdited] = useState<'price' | 'amount' | 'total' | null>(null);

  // --- Hierarchy Logic ---
  const findInDepth = (nodes: Portfolio[], id: string): boolean => {
    for (const node of nodes) {
      if (node.id === id) return true;
      if (findInDepth(node.children, id)) return true;
    }
    return false;
  };

  // Find which root contains the currently selected portfolio
  const activeRoot = rootPortfolios.find(r => r.id === portfolio?.id || findInDepth(r.children, portfolio?.id || ''));
  
  // Find which direct child of the root is active (or contains the active selection)
  const activeChild = activeRoot?.children.find(c => c.id === portfolio?.id || findInDepth(c.children, portfolio?.id || ''));


  // Auto-calculation logic
  useEffect(() => {
    const p = parseFloat(price) || 0;
    const a = parseFloat(amount) || 0;
    const t = parseFloat(total) || 0;

    if (lastEdited === 'price' || lastEdited === 'amount') {
      if (p > 0 && a > 0) {
        setTotal((p * a).toString());
      }
    } else if (lastEdited === 'total') {
      if (t > 0 && p > 0) {
        setAmount((t / p).toFixed(6)); // Precision for crypto
      }
    }
  }, [price, amount, total, lastEdited]);

  const getPriceInToman = () => {
    const p = parseFloat(price) || 0;
    return currency === 'tether' ? p * tetherPrice : p;
  };

  const calculateFee = () => {
    const totalVal = parseFloat(total) || 0;
    const fVal = parseFloat(feeValue) || 0;
    const totalToman = currency === 'tether' ? totalVal * tetherPrice : totalVal;

    if (feeType === 'percentage') {
      return totalToman * (fVal / 100);
    }
    return fVal; // Fixed amount assumed in Toman for simplicity
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!portfolio) return;

    const finalPrice = getPriceInToman();
    const finalFee = calculateFee();
    const finalAmount = parseFloat(amount);
    const finalTotal = parseFloat(total);

    if (type === 'buy' && (finalTotal * (currency === 'tether' ? tetherPrice : 1) + finalFee) > cashBalance) {
      alert('موجودی نقد کافی نیست!');
      return;
    }

    if (type === 'sell') {
        const existingAsset = portfolio.assets.find(a => a.name === assetName);
        if (!existingAsset || existingAsset.amount < finalAmount) {
             alert('موجودی دارایی کافی نیست!');
             return;
        }
    }

    onTrade({
      type,
      assetName,
      price: finalPrice,
      amount: finalAmount,
      totalValue: currency === 'tether' ? finalTotal * tetherPrice : finalTotal,
      fee: finalFee,
    });

    // Reset basics
    setAmount('');
    setTotal('');
  };

  const handleSellAll = () => {
    if (!assetName || !portfolio) return;
    const asset = portfolio.assets.find(a => a.name === assetName);
    if (asset) {
        setType('sell');
        setAmount(asset.amount.toString());
        setLastEdited('amount'); 
        // Logic will calculate total if price is set, otherwise user sets price
    }
  };

  const calculatedFee = calculateFee();
  const totalPriceToman = parseFloat(total || '0') * (currency === 'tether' ? tetherPrice : 1);
  const netAmount = type === 'buy' 
    ? totalPriceToman + calculatedFee 
    : totalPriceToman - calculatedFee;

  return (
    <Card className="h-fit sticky top-6">
      <CardHeader 
        title="ثبت معامله" 
        action={
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
             <button onClick={() => setType('buy')} className={`px-3 py-1 text-sm rounded-md transition-all ${type === 'buy' ? 'bg-green-500 text-white shadow' : 'text-slate-500 hover:text-slate-900'}`}>خرید</button>
             <button onClick={() => setType('sell')} className={`px-3 py-1 text-sm rounded-md transition-all ${type === 'sell' ? 'bg-red-500 text-white shadow' : 'text-slate-500 hover:text-slate-900'}`}>فروش</button>
          </div>
        }
      />
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        
        {/* Portfolio Selection Hierarchy */}
        <div className="grid grid-cols-2 gap-3 pb-4 border-b border-slate-100">
           <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                 <FolderTree size={12} />
                 سبد اصلی
              </label>
              <select 
                className="w-full h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                value={activeRoot?.id || ''}
                onChange={(e) => onPortfolioSelect(e.target.value)}
              >
                <option value="" disabled>انتخاب کنید</option>
                {rootPortfolios.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
           </div>
           
           <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                 <ArrowRight size={12} className="rotate-180" />
                 زیرمجموعه
              </label>
              <select 
                className="w-full h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                value={activeChild?.id || ''}
                onChange={(e) => onPortfolioSelect(e.target.value)}
                disabled={!activeRoot || activeRoot.children.length === 0}
              >
                <option value="">
                  {activeRoot?.children.length === 0 ? 'بدون زیرمجموعه' : 'انتخاب زیرمجموعه (اختیاری)'}
                </option>
                {activeRoot?.children.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
           </div>
        </div>

        {/* Info if no portfolio selected */}
        {!portfolio && (
           <div className="text-center p-4 bg-slate-50 rounded-lg text-slate-400 text-sm border border-dashed border-slate-200">
             <Wallet size={24} className="mx-auto mb-2 opacity-50" />
             لطفاً یک سبد را از بالا انتخاب کنید
           </div>
        )}

        {/* Asset Selection */}
        {portfolio && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">دارایی</label>
          <div className="flex gap-2">
            <input 
               list="assets-list"
               className="flex-1 h-10 rounded-md border border-slate-300 px-3 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
               placeholder="نام نماد (مثلاً Gold)"
               value={assetName}
               onChange={(e) => setAssetName(e.target.value)}
               required
            />
            <datalist id="assets-list">
                {portfolio.assets.map(a => <option key={a.id} value={a.name} />)}
            </datalist>
            {type === 'sell' && (
                <button type="button" onClick={handleSellAll} className="px-3 text-xs bg-slate-100 text-slate-600 rounded border border-slate-200 hover:bg-slate-200">کل موجودی</button>
            )}
          </div>
        </div>
        )}

        {/* Price & Currency */}
        <div className="grid grid-cols-2 gap-3">
             <Input 
                label="قیمت واحد" 
                type="number" 
                step="any"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setLastEdited('price'); }}
                placeholder="0"
                required
                disabled={!portfolio}
             />
             <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">ارز پایه</label>
                <select 
                    value={currency} 
                    onChange={(e) => setCurrency(e.target.value as any)}
                    className="w-full h-10 rounded-md border border-slate-300 px-3 text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none disabled:bg-slate-50"
                    disabled={!portfolio}
                >
                    <option value="toman">تومان</option>
                    <option value="tether">تتر</option>
                </select>
             </div>
        </div>

        {/* Amount & Total */}
        <div className="grid grid-cols-2 gap-3">
            <Input 
                label="مقدار (تعداد)" 
                type="number" 
                step="any"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setLastEdited('amount'); }}
                placeholder="0"
                required
                disabled={!portfolio}
             />
             <Input 
                label={`ارزش کل (${currency === 'toman' ? 'تومان' : 'تتر'})`}
                type="number" 
                step="any"
                value={total}
                onChange={(e) => { setTotal(e.target.value); setLastEdited('total'); }}
                placeholder="0"
                required
                disabled={!portfolio}
             />
        </div>

        {/* Fee Section */}
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-3">
            <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                    <Calculator size={12} /> کارمزد
                </span>
                <div className="flex gap-2">
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="radio" checked={feeType === 'percentage'} onChange={() => setFeeType('percentage')} disabled={!portfolio} />
                        درصد
                    </label>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="radio" checked={feeType === 'fixed'} onChange={() => setFeeType('fixed')} disabled={!portfolio} />
                        ثابت
                    </label>
                </div>
            </div>
            <Input 
                value={feeValue} 
                onChange={(e) => setFeeValue(e.target.value)} 
                type="number" 
                className="bg-white"
                suffix={feeType === 'percentage' ? '%' : 'تومان'}
                disabled={!portfolio}
            />
            <div className="flex justify-between text-xs text-slate-500 px-1">
                <span>مبلغ کارمزد:</span>
                <span>{formatCurrency(calculatedFee)}</span>
            </div>
        </div>

        {/* Summary & Submit */}
        <div className="border-t border-slate-200 pt-4 space-y-3">
             <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">
                    {type === 'buy' ? 'مبلغ قابل پرداخت:' : 'مبلغ دریافتی:'}
                </span>
                <span className={`font-bold text-lg ${type === 'buy' ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(Math.abs(netAmount))}
                </span>
             </div>
             
             <Button 
                type="submit" 
                variant={type === 'buy' ? 'primary' : 'danger'} 
                className="w-full flex items-center gap-2 justify-center"
                disabled={!assetName || !amount || !price || !portfolio}
            >
                {type === 'buy' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                {type === 'buy' ? 'ثبت خرید' : 'ثبت فروش'}
             </Button>
        </div>

      </form>
    </Card>
  );
};