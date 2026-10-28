import React, { useState } from 'react';
import { BookOpen, Star, Clock, Trash2, Pin, Plus, Sparkles, AlertCircle } from 'lucide-react';
import { MemoryKeyword } from '../types';
import { memoryDecayService } from '../services/memoryDecayService';
import { DiaryList } from './DiaryList';

interface MemoryNotebookModalProps {
  memories: MemoryKeyword[];
  onClose: () => void;
}

export const MemoryNotebookModal: React.FC<MemoryNotebookModalProps> = ({ memories, onClose }) => {
  const [activeTab, setActiveTab] = useState<'permanent' | 'decaying' | 'diary'>('permanent');
  const [newKeyword, setNewKeyword] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryKeyword['category']>('preference');
  const [showAddForm, setShowAddForm] = useState(false);

  const permanentMemories = memories.filter((m) => m.isPermanent);
  const decayingMemories = memories.filter((m) => !m.isPermanent);

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    memoryDecayService.addManualPermanentMemory(newKeyword, newNotes, newCategory);
    setNewKeyword('');
    setNewNotes('');
    setShowAddForm(false);
  };

  const handleSimulateDecay = () => {
    // Fast-forward 4 hours of decay to test the forgetting curve
    memoryDecayService.applyDecay(4);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-950/45 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-950/70 text-purple-400 border border-purple-800/40">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-100 text-base sm:text-lg">雙子星貓的秘密小筆記</h2>
              <p className="text-xs text-slate-400">艾賓浩斯關鍵字動態衰變與永久記憶核心</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            關閉
          </button>
        </div>

        {/* Tab switch & Actions */}
        <div className="px-4 sm:px-5 pt-3 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 bg-slate-950/40">
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('permanent')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'permanent'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star className="w-3.5 h-3.5 fill-current" />
              <span>永不遺忘核心筆記 ({permanentMemories.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('decaying')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'decaying'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>動態衰變記憶 ({decayingMemories.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('diary')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'diary' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="貓貓記得的「主人發生過的事」，會在適當時間主動關心"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>日記</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSimulateDecay}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-purple-300 px-2 py-1 rounded bg-slate-800/70 hover:bg-slate-800 transition-colors"
              title="測試艾賓浩斯時間衰減"
            >
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>測試時間衰變</span>
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200 px-2.5 py-1 rounded-lg bg-purple-950/60 hover:bg-purple-900/60 border border-purple-800/40 transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>寫入新特質</span>
            </button>
          </div>
        </div>

        {/* Add manual memory modal inline */}
        {showAddForm && (
          <form onSubmit={handleAddManual} className="p-4 bg-purple-950/20 border-b border-purple-900/30">
            <h4 className="text-xs font-semibold text-purple-200 mb-2">手動為雙子星貓寫入不可磨滅的永久記憶：</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <input
                type="text"
                placeholder="喜好關鍵字 (如: 討厭吃香菜)"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                required
              />
              <input
                type="text"
                placeholder="備註說明 (如: 外食絕對不能加)"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as any)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
              >
                <option value="preference">偏好 (Preference)</option>
                <option value="habit">生活習慣 (Habit)</option>
                <option value="game">遊戲愛好 (Game)</option>
                <option value="food">飲食口味 (Food)</option>
                <option value="topic">感興趣的話題 (Topic)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1"
              >
                取消
              </button>
              <button
                type="submit"
                className="text-xs bg-purple-600 hover:bg-purple-500 text-white font-medium px-3 py-1 rounded-lg"
              >
                永久鎖定寫入
              </button>
            </div>
          </form>
        )}

        {/* Content List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1">
          {activeTab === 'diary' ? (
            <DiaryList />
          ) : activeTab === 'permanent' ? (
            permanentMemories.length > 0 ? (
              permanentMemories.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-950/60 border border-purple-900/40 hover:border-purple-700/60 transition-all"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
                      <span className="font-bold text-slate-100 text-sm">{item.keyword}</span>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/40">
                        {item.category}
                      </span>
                    </div>
                    {item.notes && <p className="text-xs text-slate-300 pl-6">{item.notes}</p>}
                    <div className="flex items-center gap-3 pl-6 mt-2 text-[11px] text-slate-500">
                      <span>提及頻次: {item.frequency} 次</span>
                      <span>·</span>
                      <span className="text-emerald-400">已銘刻至永久筆記（永不刪除）</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => memoryDecayService.togglePermanent(item.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors"
                      title="取消釘選至衰變區"
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => memoryDecayService.deleteMemory(item.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      title="刪除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-slate-500 text-xs">
                尚無永久筆記。常聊的話題在提及達到 4 次或熱度達到 80% 時會自動晉升為永久筆記！
              </div>
            )
          ) : decayingMemories.length > 0 ? (
            decayingMemories.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800 hover:border-slate-700 transition-all"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-200 text-sm">{item.keyword}</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      {item.category}
                    </span>
                  </div>

                  {item.notes && <p className="text-xs text-slate-400 pl-6 mb-2">{item.notes}</p>}

                  {/* Strength Bar */}
                  <div className="pl-6 space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>記憶熱度: {item.strength}%</span>
                      <span>提及頻次: {item.frequency}/4 次</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          item.strength > 60
                            ? 'bg-purple-500'
                            : item.strength > 30
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${item.strength}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => memoryDecayService.togglePermanent(item.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-purple-300 hover:bg-slate-800 transition-colors"
                    title="立即手動升格為永久記憶"
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => memoryDecayService.deleteMemory(item.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                    title="遺忘此關鍵字"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-500 text-xs">
              目前暫無衰變中的關鍵字。在聊天時多聊聊你的日常生活，雙子星貓會自動捕捉！
            </div>
          )}
        </div>

        {/* Footer tip */}
        <div className="p-3 bg-slate-950/70 border-t border-slate-800 text-xs text-slate-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-purple-400 shrink-0" />
          <span>
            關鍵字衰變機制遵循遺忘曲線：少聊的話題隨時間逐漸淡化，常聊（提及 4 次以上）即永久銘刻不可刪除。
          </span>
        </div>
      </div>
    </div>
  );
};
