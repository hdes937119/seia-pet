/**
 * 雙子星貓 chibi 的動態狀態腳本。
 *
 * 兩大類：
 *  - 運作模式（mode）：依視窗偵測 / 互動切換，會持續到情況改變
 *  - 情緒回應（emotion）：依對話或閒置隨機觸發，幾秒後自動回到運作模式
 *
 * 每個狀態 = 身體動畫（bodyAnim）+ 配件（accessories）+ 粒子特效（particles）+ 光暈（aura）。
 *
 * ▶ 換成真正的逐格動畫：把素材放進 public/pet/，再在下方 PET_SPRITES 填上：
 *     happy: { src: '/pet/happy.gif' }                              // GIF / APNG / WebP 動圖
 *     sad:   { src: '/pet/sad-sheet.png', frames: 8, fps: 10 }      // 橫向排列的 Sprite sheet
 *   有素材的狀態會改用素材，配件與粒子特效照樣疊上去（不需要的可以把 accessories 清空）。
 */

export type PetModeId = 'idle' | 'patting' | 'gaming' | 'gemini_web' | 'line';
export type PetEmotionId =
  | 'happy'
  | 'hungry'
  | 'sad'
  | 'angry'
  | 'proud'
  | 'confused'
  | 'loving';
export type PetStateId = PetModeId | PetEmotionId;

export const PET_EMOTIONS: PetEmotionId[] = [
  'happy',
  'hungry',
  'sad',
  'angry',
  'proud',
  'confused',
  'loving',
];

export type ParticleKind =
  | 'heart'
  | 'note'
  | 'sparkle'
  | 'rain'
  | 'question'
  | 'anger'
  | 'gloom'
  | 'speech'
  | 'exclaim';

/** 粒子出現的區域（以立繪寬高的 % 表示） */
export type ParticleArea = 'head' | 'ears' | 'around' | 'above' | 'body';

export interface ParticleSpec {
  kind: ParticleKind;
  count: number;
  area: ParticleArea;
}

export type AccessoryId =
  | 'blush'
  | 'happyEyes'
  | 'smugEyes'
  | 'sparkleEyes'
  | 'tears'
  | 'drool'
  | 'pout'
  | 'headphones'
  | 'controller'
  | 'glasses'
  | 'hologram'
  | 'notebook'
  | 'phone'
  | 'lineBubble'
  | 'desk';

export type AuraId = 'pink' | 'gold' | 'blue' | 'violet' | 'green' | 'rays' | 'gloom';

export interface SpriteAsset {
  src: string;
  frames?: number; // >1 表示橫向 Sprite sheet
  fps?: number;
}

export interface PetStateConfig {
  id: PetStateId;
  kind: 'mode' | 'emotion';
  label: string;
  emoji: string;
  bodyAnim: string; // index.css 裡的動畫 class
  filter?: string; // 套在立繪上的 CSS filter
  accessories: AccessoryId[];
  particles: ParticleSpec[];
  aura?: AuraId;
}

/** 有逐格動畫素材時填在這裡（見檔案開頭說明） */
export const PET_SPRITES: Partial<Record<PetStateId, SpriteAsset>> = {};

export const BASE_SPRITE = '/pet/gemini-chibi.png';

export const PET_STATES: Record<PetStateId, PetStateConfig> = {
  idle: {
    id: 'idle',
    kind: 'mode',
    label: '待機',
    emoji: '✨',
    bodyAnim: 'pet-anim-float',
    accessories: [],
    particles: [{ kind: 'sparkle', count: 3, area: 'around' }],
  },

  // ── 一、運作模式 ───────────────────────────────
  patting: {
    id: 'patting',
    kind: 'mode',
    label: '摸頭',
    emoji: '🤚',
    bodyAnim: 'pet-anim-squish',
    accessories: ['happyEyes', 'blush'],
    particles: [
      { kind: 'heart', count: 6, area: 'head' },
      { kind: 'note', count: 3, area: 'head' },
    ],
    aura: 'pink',
  },
  gaming: {
    id: 'gaming',
    kind: 'mode',
    label: '玩遊戲',
    emoji: '🎮',
    bodyAnim: 'pet-anim-rock',
    accessories: ['headphones', 'controller'],
    particles: [{ kind: 'exclaim', count: 1, area: 'above' }],
    aura: 'violet',
  },
  gemini_web: {
    id: 'gemini_web',
    kind: 'mode',
    label: 'Gemini 網頁',
    emoji: '🔮',
    bodyAnim: 'pet-anim-float-slow',
    accessories: ['glasses', 'hologram', 'notebook'],
    particles: [{ kind: 'sparkle', count: 7, area: 'ears' }],
    aura: 'blue',
  },
  line: {
    id: 'line',
    kind: 'mode',
    label: 'LINE',
    emoji: '💬',
    bodyAnim: 'pet-anim-peek',
    accessories: ['lineBubble', 'phone'],
    particles: [
      { kind: 'speech', count: 1, area: 'above' },
      { kind: 'exclaim', count: 1, area: 'above' },
    ],
    aura: 'green',
  },

  // ── 二、情緒回應 ───────────────────────────────
  happy: {
    id: 'happy',
    kind: 'emotion',
    label: '開心',
    emoji: '😆',
    bodyAnim: 'pet-anim-bounce',
    accessories: ['happyEyes', 'blush'],
    particles: [{ kind: 'sparkle', count: 10, area: 'around' }],
    aura: 'gold',
  },
  hungry: {
    id: 'hungry',
    kind: 'emotion',
    label: '想吃',
    emoji: '🤤',
    bodyAnim: 'pet-anim-lean',
    accessories: ['sparkleEyes', 'drool', 'desk'],
    particles: [{ kind: 'sparkle', count: 4, area: 'head' }],
  },
  sad: {
    id: 'sad',
    kind: 'emotion',
    label: '悲傷',
    emoji: '😢',
    bodyAnim: 'pet-anim-shrink',
    filter: 'saturate(0.7) brightness(0.92)',
    accessories: ['tears'],
    particles: [
      { kind: 'rain', count: 12, area: 'around' },
      { kind: 'gloom', count: 4, area: 'head' },
    ],
    aura: 'gloom',
  },
  angry: {
    id: 'angry',
    kind: 'emotion',
    label: '生氣',
    emoji: '💢',
    bodyAnim: 'pet-anim-stomp',
    accessories: ['pout', 'blush'],
    particles: [{ kind: 'anger', count: 2, area: 'head' }],
  },
  proud: {
    id: 'proud',
    kind: 'emotion',
    label: '驕傲',
    emoji: '😤',
    bodyAnim: 'pet-anim-proud',
    accessories: ['smugEyes'],
    particles: [{ kind: 'sparkle', count: 6, area: 'around' }],
    aura: 'rays',
  },
  confused: {
    id: 'confused',
    kind: 'emotion',
    label: '疑惑',
    emoji: '❓',
    bodyAnim: 'pet-anim-tilt',
    accessories: [],
    particles: [{ kind: 'question', count: 3, area: 'above' }],
  },
  loving: {
    id: 'loving',
    kind: 'emotion',
    label: '愛',
    emoji: '💕',
    bodyAnim: 'pet-anim-shy',
    accessories: ['blush', 'happyEyes'],
    particles: [{ kind: 'heart', count: 9, area: 'around' }],
    aura: 'pink',
  },
};

export const ALL_PET_STATES = Object.values(PET_STATES);

export function isPetEmotion(value: unknown): value is PetEmotionId {
  return typeof value === 'string' && (PET_EMOTIONS as string[]).includes(value);
}
