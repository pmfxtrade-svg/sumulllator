import React from 'react';

// Card Component
export interface CardProps {
  children?: React.ReactNode;
  className?: string;
}

export const Card = ({ children, className = "" }: CardProps) => (
  <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
    {children}
  </div>
);

export const CardHeader = ({ title, action }: { title: string, action?: React.ReactNode }) => (
  <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
    <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
    {action && <div>{action}</div>}
  </div>
);

// Button Component
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = ({ children, variant = 'primary', size = 'md', className = "", ...props }: ButtonProps) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 focus:ring-slate-500",
    danger: "bg-red-500 text-white hover:bg-red-600 focus:ring-red-500",
    outline: "border border-slate-300 bg-transparent text-slate-700 hover:bg-slate-50",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
};

// Input Component
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  suffix?: string;
}

export const Input = ({ label, error, suffix, className = "", ...props }: InputProps) => (
  <div className="flex flex-col gap-1.5">
    {label && <label className="text-sm font-medium text-slate-700">{label}</label>}
    <div className="relative flex items-center">
      <input
        className={`flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:cursor-not-allowed disabled:bg-slate-50 ${error ? 'border-red-500 focus:ring-red-500' : ''} ${className}`}
        {...props}
      />
      {suffix && <span className="absolute left-3 text-slate-400 text-sm">{suffix}</span>}
    </div>
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
);

// Formatter Helpers
export const formatNumber = (num: number) => new Intl.NumberFormat('fa-IR').format(num);
export const formatCurrency = (num: number) => new Intl.NumberFormat('fa-IR').format(num) + ' تومان';

export const numberToPersianWords = (num: number): string => {
  if (num === 0) return 'صفر';
  
  const delimiter = ' و ';
  const unitNames = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];
  
  let numberStr = Math.floor(num).toString();
  
  // Pad to multiple of 3
  while (numberStr.length % 3 !== 0) {
      numberStr = '0' + numberStr;
  }
  
  const groups = [];
  for (let i = 0; i < numberStr.length; i += 3) {
      groups.push(parseInt(numberStr.substring(i, i + 3)));
  }
  
  const groupCount = groups.length;
  
  const convertUnder1000 = (n: number) => {
      if (n === 0) return '';
      
      const ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
      const tens = ['', 'ده', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
      const teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
      const hundreds = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
      
      let str = '';
      
      const h = Math.floor(n / 100);
      const t = Math.floor((n % 100) / 10);
      const o = n % 10;
      
      if (h > 0) {
          str += hundreds[h];
          if (t > 0 || o > 0) str += delimiter;
      }
      
      if (t > 0) {
          if (t === 1) {
              str += teens[o];
          } else {
              str += tens[t];
              if (o > 0) str += delimiter + ones[o];
          }
      } else if (o > 0) {
          str += ones[o];
      }
      
      return str;
  };

  let result = '';
  for (let i = 0; i < groupCount; i++) {
      const groupVal = groups[i];
      const unitIndex = groupCount - 1 - i;
      
      if (groupVal > 0) {
          if (result !== '') result += delimiter;
          result += convertUnder1000(groupVal) + ' ' + unitNames[unitIndex];
      }
  }
  
  return result.trim();
};