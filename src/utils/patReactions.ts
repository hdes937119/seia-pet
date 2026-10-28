import type { PersonalityConfig } from '../types';

/**
 * 摸頭時的反應台詞，依人設滑桿挑選語氣。
 * 門檻與後端 server/persona.ts 相同：> 70 算高、< 30 算低。
 */
const REACTIONS = {
  tsundere: [
    '哼！本喵才不是隨便給人摸的呢……（發出呼嚕聲）',
    '才、才沒有很舒服呢！…再摸一下下也不是不行啦',
    '喂！誰准你摸了…算了，看你今天辛苦就勉強允許一次喵',
  ],
  sharp: [
    '摸夠了沒？…好吧，再給你摸三秒。',
    '手法還行，勉強及格喵。下次記得順毛摸。',
    '這麼閒還有空摸我？工作做完了嗎喵～',
  ],
  gentle: [
    '喵～♪ 好舒服～謝謝主人摸摸！',
    '主人的手好溫暖喔，最喜歡被你摸頭了～',
    '呼嚕呼嚕～今天也辛苦了，換我陪著你喵♪',
  ],
  neutral: [
    '喵～♪ 好舒服～再多摸兩下嘛！',
    '呼嚕呼嚕～本喵的心情值直接飆升 100 點！',
    '主人今天辛苦啦～本喵的大豆包能量分你一半喵！',
  ],
};

export function pickPatReaction(p: Partial<PersonalityConfig>): string {
  const tsundere = p.tsundere ?? 60;
  const sharp = p.sharpTongue ?? 50;
  const pool =
    tsundere > 70
      ? REACTIONS.tsundere
      : sharp < 30
        ? REACTIONS.gentle
        : sharp > 70
          ? REACTIONS.sharp
          : REACTIONS.neutral;
  return pool[Math.floor(Math.random() * pool.length)];
}
