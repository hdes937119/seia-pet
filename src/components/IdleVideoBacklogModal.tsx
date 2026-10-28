import React, { useState } from 'react';
import { Film, Compass, ExternalLink, MessageCircle, Sparkles, RefreshCw, Trash2 } from 'lucide-react';
import { DiscoveredVideo } from '../types';

interface IdleVideoBacklogModalProps {
  videos: DiscoveredVideo[];
  onClose: () => void;
  onExploreNow: () => Promise<void>;
  onAskAboutVideo: (video: DiscoveredVideo) => void;
  onDeleteVideo: (id: string) => void;
}

export const IdleVideoBacklogModal: React.FC<IdleVideoBacklogModalProps> = ({
  videos,
  onClose,
  onExploreNow,
  onAskAboutVideo,
  onDeleteVideo,
}) => {
  const [isExploring, setIsExploring] = useState(false);

  const handleExplore = async () => {
    setIsExploring(true);
    try {
      await onExploreNow();
    } finally {
      setIsExploring(false);
    }
  };

  const getCategoryColor = (category: DiscoveredVideo['category']) => {
    switch (category) {
      case 'gaming':
        return 'text-rose-400 bg-rose-950/60 border-rose-800/40';
      case 'animation':
        return 'text-purple-400 bg-purple-950/60 border-purple-800/40';
      case 'funny':
        return 'text-amber-400 bg-amber-950/60 border-amber-800/40';
      case 'tech':
        return 'text-sky-400 bg-sky-950/60 border-sky-800/40';
      default:
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-950/70 text-indigo-400 border border-indigo-800/40">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-100 text-base sm:text-lg">貓貓的摸魚影音手帳</h2>
              <p className="text-xs text-slate-400">待機時根據性格與主人喜好自主探索的私房清單</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            關閉
          </button>
        </div>

        {/* Action Bar */}
        <div className="px-4 sm:px-5 py-2.5 flex items-center justify-between border-b border-slate-800/60 bg-slate-950/40 text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            共記錄了 {videos.length} 部好片與精采話題
          </span>
          <button
            onClick={handleExplore}
            disabled={isExploring}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isExploring ? 'animate-spin' : ''}`} />
            <span>立即讓貓貓上網搜一部</span>
          </button>
        </div>

        {/* Video List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1">
          {videos.length > 0 ? (
            videos.map((vid) => (
              <div
                key={vid.id}
                className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-purple-800/50 transition-all space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${getCategoryColor(vid.category)}`}>
                      {vid.category}
                    </span>
                    <span className="text-[10px] text-amber-300 font-semibold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/30">
                      #{vid.tag}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">{vid.discoveredAt} 發現</span>
                  </div>
                </div>

                <h3 className="font-bold text-slate-100 text-sm sm:text-base leading-snug">{vid.title}</h3>
                <p className="text-xs text-slate-300">{vid.summary}</p>

                {/* Cat's personal spicy commentary */}
                <div className="p-2.5 rounded-lg bg-purple-950/40 border border-purple-800/30 text-xs text-purple-200">
                  <span className="font-bold text-purple-400">雙子星貓短評：</span>
                  <span>「{vid.catReview}」</span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => onDeleteVideo(vid.id)}
                    className="flex items-center justify-center p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors mr-auto"
                    title="刪除這部影片"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      onAskAboutVideo(vid);
                      onClose();
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>在對話中聊這部</span>
                  </button>

                  <a
                    href={vid.searchKeyword?.startsWith('http') ? vid.searchKeyword : `https://www.youtube.com/results?search_query=${encodeURIComponent(vid.searchKeyword || vid.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>搜尋觀看</span>
                  </a>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-16 text-slate-500 text-xs flex flex-col items-center gap-2">
              <Compass className="w-8 h-8 text-slate-600" />
              <span>貓貓還在待機摸魚中，點擊上方按鈕讓她立刻去網上挖寶吧！</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
