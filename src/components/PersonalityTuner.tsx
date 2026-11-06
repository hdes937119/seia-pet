import React from 'react';
import { Sliders, Flame, Heart, Volume2, Sparkles, Wand2 } from 'lucide-react';
import { PersonalityConfig } from '../types';

interface PersonalityTunerProps {
  personality: PersonalityConfig;
  onChange: (updated: PersonalityConfig) => void;
}

export const PersonalityTuner: React.FC<PersonalityTunerProps> = ({ personality, onChange }) => {
  const updateField = (key: keyof PersonalityConfig, value: any) => {
    onChange({
      ...personality,
      [key]: value,
    });
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-slate-200 backdrop-blur-md space-y-4">
      {/* === PERSONALITY SLIDERS SECTION === */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h3 className="font-semibold text-slate-100 text-sm">微性格調音台 (Personality Sliders)</h3>
          </div>
          <span className="text-xs text-purple-300 bg-purple-950/60 border border-purple-800/40 px-2 py-0.5 rounded-full font-medium">
            即時生效
          </span>
        </div>

        {/* Sliders Grid */}
        <div className="space-y-3.5 mb-4">
          {/* Slider 1: 毒舌 ⟷ 體貼 */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="flex items-center gap-1 text-slate-300 font-medium">
                <Heart className="w-3.5 h-3.5 text-rose-400" /> 溫柔體貼
              </span>
              <span className="text-purple-400 font-mono font-semibold">
                毒舌度: {personality.sharpTongue}%
              </span>
              <span className="flex items-center gap-1 text-slate-300 font-medium">
                極致毒舌 <Flame className="w-3.5 h-3.5 text-purple-400" />
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={personality.sharpTongue}
              onChange={(e) => updateField('sharpTongue', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
          </div>

          {/* Slider 2: 聒噪 ⟷ 恬靜 */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300 font-medium">恬靜省話</span>
              <span className="text-indigo-400 font-mono font-semibold">
                話癆度: {personality.chatty}%
              </span>
              <span className="flex items-center gap-1 text-slate-300 font-medium">
                嘰嘰喳喳 <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={personality.chatty}
              onChange={(e) => updateField('chatty', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>

          {/* Slider 3: 幽默 ⟷ 認真 */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300 font-medium">嚴肅嚴謹</span>
              <span className="text-amber-400 font-mono font-semibold">
                搞笑整活: {personality.humorous}%
              </span>
              <span className="flex items-center gap-1 text-slate-300 font-medium">
                大豆包整活 <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={personality.humorous}
              onChange={(e) => updateField('humorous', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          {/* Slider 4: 傲嬌度 */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300 font-medium">坦率直接</span>
              <span className="text-pink-400 font-mono font-semibold">
                傲嬌指數: {personality.tsundere}%
              </span>
              <span className="text-slate-300 font-medium">口嫌體正直</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={personality.tsundere}
              onChange={(e) => updateField('tsundere', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
            />
          </div>
        </div>

        {/* Custom Prompt Box */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-slate-300 mb-1 font-medium">
            <Wand2 className="w-3.5 h-3.5 text-purple-400" />
            <span>今日自訂微性格提示詞（隨喜好自由補充）：</span>
          </label>
          <textarea
            rows={2}
            value={personality.customPrompt || ''}
            onChange={(e) => updateField('customPrompt', e.target.value)}
            placeholder="例如：今天我加班心情很差，請多溫柔鼓勵我 / 今天排位連跪，請狠狠吐槽我的下飯操作..."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500/60 transition-colors resize-none"
          />
        </div>
      </div>
    </div>
  );
};
