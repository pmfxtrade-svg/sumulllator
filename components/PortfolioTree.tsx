import React, { useState } from 'react';
import { Portfolio } from '../types';
import { ChevronDown, ChevronLeft, Folder, FolderOpen, Plus, Trash2, Edit2, Layers } from 'lucide-react';
import { formatCurrency } from './ui';

interface PortfolioTreeProps {
  portfolios: Portfolio[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (parentId: string | null) => void;
  onEdit: (portfolio: Portfolio) => void;
  onDelete: (id: string) => void;
  depth?: number;
}

export const PortfolioTree: React.FC<PortfolioTreeProps> = ({ 
  portfolios, 
  selectedId, 
  onSelect, 
  onAdd, 
  onEdit,
  onDelete, 
  depth = 0 
}) => {
  return (
    <div className="flex flex-col gap-1">
      {/* All Portfolios Option (Only at root level) */}
      {depth === 0 && (
        <div 
          onClick={() => onSelect('ALL_ROOT')}
          className={`
            flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer transition-all mb-2 border-b-2 border-slate-100
            ${selectedId === 'ALL_ROOT' ? 'bg-slate-800 text-white shadow-md' : 'bg-white hover:bg-slate-50 text-slate-700'}
          `}
        >
          <div className={`p-1.5 rounded-md ${selectedId === 'ALL_ROOT' ? 'bg-white/10' : 'bg-brand-50 text-brand-600'}`}>
             <Layers size={18} />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm">کل سبدها</span>
            <span className={`text-[10px] ${selectedId === 'ALL_ROOT' ? 'text-slate-400' : 'text-slate-400'}`}>نمای کلی سرمایه</span>
          </div>
        </div>
      )}

      {portfolios.map((portfolio) => (
        <PortfolioNode 
          key={portfolio.id}
          portfolio={portfolio}
          selectedId={selectedId}
          onSelect={onSelect}
          onAdd={onAdd}
          onEdit={onEdit}
          onDelete={onDelete}
          depth={depth}
        />
      ))}
      
      {/* Root level Add Button */}
      {depth === 0 && (
        <button 
          onClick={() => onAdd(null)}
          className="mt-2 flex items-center justify-center gap-2 w-full py-2 text-sm text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors border border-dashed border-brand-200"
        >
          <Plus size={16} />
          <span>سبد اصلی جدید</span>
        </button>
      )}
    </div>
  );
};

const PortfolioNode: React.FC<{
  portfolio: Portfolio;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (parentId: string | null) => void;
  onEdit: (portfolio: Portfolio) => void;
  onDelete: (id: string) => void;
  depth: number;
}> = ({ portfolio, selectedId, onSelect, onAdd, onEdit, onDelete, depth }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isSelected = selectedId === portfolio.id;
  const hasChildren = portfolio.children.length > 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  return (
    <div className="select-none">
      <div 
        className={`
          group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all
          ${isSelected ? 'bg-brand-600 text-white shadow-md' : 'hover:bg-slate-100 text-slate-700'}
        `}
        style={{ marginRight: `${depth * 12}px` }}
        onClick={() => onSelect(portfolio.id)}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <button 
            onClick={handleToggle}
            className={`p-1 rounded hover:bg-black/10 ${!hasChildren && 'invisible'}`}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
          </button>
          
          {isOpen ? <FolderOpen size={18} className={isSelected ? 'text-white' : 'text-brand-500'} /> : <Folder size={18} className={isSelected ? 'text-white' : 'text-slate-400'} />}
          
          <div className="flex flex-col min-w-0">
            <span className="font-medium truncate text-sm">{portfolio.name}</span>
            <span className={`text-[10px] truncate ${isSelected ? 'text-brand-100' : 'text-slate-400'}`}>
              تخصیص: {formatCurrency(portfolio.allocation)}
            </span>
          </div>
        </div>

        <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'opacity-100' : ''}`}>
           <button 
            onClick={(e) => { e.stopPropagation(); onAdd(portfolio.id); }}
            className={`p-1 rounded hover:bg-white/20`}
            title="افزودن زیرمجموعه"
          >
            <Plus size={14} />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onEdit(portfolio); }}
            className={`p-1 rounded hover:bg-white/20`}
            title="ویرایش سبد"
          >
            <Edit2 size={14} />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(portfolio.id); }}
            className={`p-1 rounded hover:bg-red-500/80 hover:text-white ${isSelected ? 'text-white' : 'text-red-500'}`}
            title="حذف سبد"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {isOpen && hasChildren && (
        <div className="mt-1 border-r-2 border-slate-100 pr-2 mr-3">
          <PortfolioTree 
            portfolios={portfolio.children}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAdd}
            onEdit={onEdit}
            onDelete={onDelete}
            depth={depth + 1}
          />
        </div>
      )}
    </div>
  );
};