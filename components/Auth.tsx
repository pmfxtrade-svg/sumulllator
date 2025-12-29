import React, { useState } from 'react';
import { supabase, SQL_SCHEMA } from '../supabaseClient';
import { Card, Button, Input } from './ui';
import { Database, Copy, Check, TrendingUp, AlertCircle } from 'lucide-react';

interface AuthProps {
  onAuthSuccess: () => void;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        // Auto login is handled by session listener in App, but let's inform user if email confirm needed
        // For this demo assuming auto-confirm or immediate login
      }
      onAuthSuccess();
    } catch (err: any) {
      setError(err.message || 'خطایی رخ داد');
    } finally {
      setLoading(false);
    }
  };

  const copySql = () => {
    navigator.clipboard.writeText(SQL_SCHEMA);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-64 bg-brand-600 skew-y-3 origin-top-left z-0"></div>
      
      <Card className="w-full max-w-md z-10 p-8 shadow-xl border-t-4 border-brand-500">
        <div className="text-center mb-8">
          <div className="bg-brand-50 p-3 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 text-brand-600">
            <TrendingUp size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">شبیه‌ساز تریدر پرو</h1>
          <p className="text-slate-500 text-sm mt-2">وارد حساب خود شوید تا اطلاعات شما ذخیره شود</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <Input 
            label="ایمیل" 
            type="email" 
            placeholder="name@example.com" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            required 
            dir="ltr"
            className="text-left"
          />
          <Input 
            label="رمز عبور" 
            type="password" 
            placeholder="••••••••" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            required 
            dir="ltr"
            className="text-left"
          />
          
          <Button type="submit" className="w-full h-11 text-base mt-2" disabled={loading}>
            {loading ? 'در حال پردازش...' : (isLogin ? 'ورود به حساب' : 'ثبت نام رایگان')}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <p className="text-slate-500">
            {isLogin ? 'حساب کاربری ندارید؟' : 'قبلاً ثبت نام کرده‌اید؟'}
            <button 
              onClick={() => { setIsLogin(!isLogin); setError(null); }}
              className="text-brand-600 font-bold hover:underline mr-1"
            >
              {isLogin ? 'ثبت نام کنید' : 'وارد شوید'}
            </button>
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>تنظیمات دیتابیس (SQL)</span>
            <Database size={14} />
          </div>
          <button 
            onClick={copySql}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 transition-colors text-xs font-mono group"
          >
            <span className="truncate flex-1 text-right ml-2">Copy Supabase SQL Schema</span>
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="opacity-50 group-hover:opacity-100" />}
          </button>
        </div>
      </Card>
    </div>
  );
};