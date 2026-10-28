import React, { useState } from 'react';
import { Sliders, Flame, Heart, Volume2, Sparkles, Wand2, Music2 } from 'lucide-react';
import { PersonalityConfig } from '../types';
import { voiceService, MoeVoiceMode } from '../services/voiceService';

interface PersonalityTunerProps {
  personality: PersonalityConfig;
  onChange: (updated: PersonalityConfig) => void;
}

export const PersonalityTuner: React.FC<PersonalityTunerProps> = ({ personality, onChange }) => {
  const [voiceMode, setVoiceMode] = useState<MoeVoiceMode>(voiceService.getVoiceMode());
  const [pitch, setPitch] = useState<number>(voiceService.getPitch());
  const [rate, setRate] = useState<number>(voiceService.getRate());

  const updateField = (key: keyof PersonalityConfig, value: any) => {
    onChange({
      ...personality,
      [key]: value,
    });
  };

  const handleVoiceModeChange = (mode: MoeVoiceMode) => {
    setVoiceMode(mode);
    voiceService.setVoiceMode(mode);
    if (mode === 'jp_seiyuu') {
      voiceService.speak('えへへ～ご主人様、双子星猫だよにゃん♪');
    } else {
      voiceService.speak('えへへ～主人！這個日系萌音你喜歡嗎喵～♪');
    }
  };

  const handlePitchChange = (val: number) => {
    setPitch(val);
    voiceService.setPitch(val);
  };

  const handleRateChange = (val: number) => {
    setRate(val);
    voiceService.setRate(val);
  };

  const handleTestVoice = () => {
    voiceService.speak('✦ 我是一隻貓，雙子座星貓！穿梭信息海跳，替你解煩惱喵～♪');
  };

  const applyPreset = (preset: {
    sharpTongue: number;
    chatty: number;
    humorous: number;
    tsundere: number;
    customPrompt: string;
  }) => {
    onChange(preset);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-slate-200 backdrop-blur-md space-y-4">
      {/* === JAPANESE MOE TTS TUNER SECTION === */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-pink-950/40 via-purple-950/40 to-indigo-950/40 border border-pink-500/30">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <Music2 className="w-4 h-4 text-pink-400" />
            <h4 className="font-bold text-xs sm:text-sm text-pink-200">
              🌸 日系萌音 TTS 聲優調音台
            </h4>
          </div>
          <button
            type="button"
            onClick={handleTestVoice}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-pink-600 hover:bg-pink-500 text-white shadow-sm transition-all"
          >
            <Volume2 className="w-3 h-3" />
            <span>試聽萌音</span>
          </button>
        </div>

        {/* 3 Moe Voice Mode Buttons */}
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => handleVoiceModeChange('moe_fast')}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
              voiceMode === 'moe_fast'
                ? 'bg-pink-600/90 text-white border-pink-400 shadow-sm'
                : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:border-pink-500/40'
            }`}
          >
            ⚡ 極速高音甜萌
          </button>
          <button
            type="button"
            onClick={() => handleVoiceModeChange('ai_cloud_moe')}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
              voiceMode === 'ai_cloud_moe'
                ? 'bg-purple-600/90 text-white border-purple-400 shadow-sm'
                : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:border-purple-500/40'
            }`}
          >
            ✨ AI 雲端萌音
          </button>
          <button
            type="button"
            onClick={() => handleVoiceModeChange('jp_seiyuu')}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
              voiceMode === 'jp_seiyuu'
                ? 'bg-amber-600/90 text-white border-amber-400 shadow-sm'
                : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:border-amber-500/40'
            }`}
          >
            🇯🇵 日語聲優腔
          </button>
        </div>

        {/* Pitch & Speed Sliders */}
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>萌度音高 (Pitch)</span>
              <span className="font-mono text-pink-300">{pitch.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="1.1"
              max="1.9"
              step="0.05"
              value={pitch}
              onChange={(e) => handlePitchChange(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
            />
          </div>
          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>元氣語速 (Speed)</span>
              <span className="font-mono text-amber-300">{rate.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.85"
              max="1.45"
              step="0.05"
              value={rate}
              onChange={(e) => handleRateChange(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
          </div>
        </div>
      </div>

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

        {/* Preset Buttons */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() =>
              applyPreset({
                sharpTongue: 85,
                chatty: 75,
                humorous: 85,
                tsundere: 90,
                customPrompt: '極致毒舌，抓住機會就狠狠吐槽主人的操作，但認錯極快',
              })
            }
            className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-200 border border-slate-700 hover:border-purple-500/50 transition-all"
          >
            😈 毒舌傲嬌貓娘
          </button>
          <button
            onClick={() =>
              applyPreset({
                sharpTongue: 15,
                chatty: 60,
                humorous: 40,
                tsundere: 15,
                customPrompt: '滿滿全糖情緒價值，無條件寵溺與鼓勵主人，語氣極度溫柔',
              })
            }
            className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-200 border border-slate-700 hover:border-rose-500/50 transition-all"
          >
            🍰 全糖溫柔大豆包
          </button>
          <button
            onClick={() =>
              applyPreset({
                sharpTongue: 50,
                chatty: 95,
                humorous: 75,
                tsundere: 40,
                customPrompt: '極度話癆，看到什麼都想問、充滿好奇心與活力喵～',
              })
            }
            className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-200 border border-slate-700 hover:border-amber-500/50 transition-all"
          >
            ⚡ 元氣話癆小夥伴
          </button>
          <button
            onClick={() =>
              applyPreset({
                sharpTongue: 20,
                chatty: 30,
                humorous: 25,
                tsundere: 10,
                customPrompt: '安靜恬靜、冷靜理性、只在關鍵時刻給予高價值建議',
              })
            }
            className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-200 border border-slate-700 hover:border-sky-500/50 transition-all"
          >
            👓 知性恬靜助理
          </button>
          <button
            onClick={() =>
              applyPreset({
                sharpTongue: 65,
                chatty: 70,
                humorous: 95,
                tsundere: 70,
                customPrompt: '經典B站哈基米二創風格，充滿大豆包迷因與歡樂笑點',
              })
            }
            className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-200 border border-slate-700 hover:border-emerald-500/50 transition-all"
          >
            🎭 經典整活大豆包
          </button>
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
