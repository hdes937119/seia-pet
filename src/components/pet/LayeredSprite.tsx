import React, { useEffect, useState } from 'react';
import { voiceService } from '../../services/voiceService';
import type { PetStateId } from './petStates';

/**
 * 分圖層的立繪（galgame 立繪差分的做法）：
 *   尾巴（在最後面，繞著尾巴根部擺動）→ 身體 → 嘴型差分（說話時跟著音量開合）→ 閉眼差分（眨眼時才顯示）
 * 三張圖畫布大小一樣（3:4），疊在一起就會自動對齊。
 */
export const LAYERS = {
  tail: '/pet/layered/tail.webp',
  body: '/pet/layered/body.webp',
  eyesClosed: '/pet/layered/eyes-closed.webp',
  mouthClosed: '/pet/layered/mouth-closed.webp',
  mouthHalf: '/pet/layered/mouth-half.webp',
};

/**
 * 情境姿勢：頭和臉的位置跟原圖一樣，只換身體和手上的東西，所以眨眼、對嘴、尾巴照樣能用。
 * （以後有「加了桌椅道具」的版本，直接換掉這裡的圖就好）
 */
const POSE_BODY: Partial<Record<PetStateId, string>> = {
  gaming: '/pet/layered/pose-gaming.webp',
  gemini_web: '/pet/layered/pose-web.webp',
  line: '/pet/layered/pose-line.webp',
  hungry: '/pet/layered/pose-eating.webp',
  eating: '/pet/layered/pose-eating.webp',
  // 情緒：整個人的動作和表情都換（生氣插腰握拳、得意攤手、疑惑托下巴、難過耳朵垂下）
  angry: '/pet/layered/pose-angry.webp',
  proud: '/pet/layered/pose-proud.webp',
  confused: '/pet/layered/pose-confused.webp',
  sad: '/pet/layered/pose-sad.webp',
  loving: '/pet/layered/pose-loving.webp',
  // 體力與天氣
  tired: '/pet/layered/pose-tired.webp',
  exhausted: '/pet/layered/pose-exhausted.webp',
  rainy: '/pet/layered/pose-rainy.webp',
  // 微表情（開口前的一瞬間）
  eyeroll: '/pet/layered/pose-eyeroll.webp',
  sigh: '/pet/layered/pose-sigh.webp',
  nervous: '/pet/layered/pose-nervous.webp',
  shy: '/pet/layered/pose-shy.webp',
  smirk: '/pet/layered/pose-smirk.webp',
};

/** 這些表情不眨眼（原本的閉眼是開心的彎彎笑眼，放在生氣、難過的臉上會很怪；表情只維持幾秒） */
const NO_BLINK: PetStateId[] = [
  'angry',
  'proud',
  'confused',
  'sad',
  'loving',
  'tired',
  'exhausted',
  'rainy',
  'eyeroll',
  'sigh',
  'nervous',
  'shy',
  'smirk',
];

/**
 * 這些姿勢的嘴本身就是表情的一部分（嘟嘴、抿嘴、壞笑…）：
 * 說話時「閉嘴」那一格保留姿勢自己的嘴，只有張嘴時才換成半開的嘴。
 */
const OWN_MOUTH: PetStateId[] = [
  'gemini_web',
  'angry',
  'proud',
  'confused',
  'sad',
  'loving',
  'tired',
  'exhausted',
  'rainy',
  'eyeroll',
  'sigh',
  'nervous',
  'shy',
  'smirk',
];

/**
 * 表情立繪自己的閉眼版（只有眼睛那一塊）：有的話這張立繪也會眨眼，
 * 而且是用它自己的表情閉眼（例如下雨天皺著眉閉眼），不是原圖的開心笑眼。
 */
const POSE_BLINK: Partial<Record<PetStateId, string>> = {
  rainy: '/pet/layered/pose-rainy-blink.webp',
};

/** 要蓋在眨眼／嘴型上面的東西（眼鏡：眨眼時不能消失） */
const POSE_OVERLAY: Partial<Record<PetStateId, string>> = {
  gemini_web: '/pet/layered/pose-web-glasses.webp',
};

/** 微表情只維持 3.5 秒：期間不對嘴，直接用立繪本身的表情（不然無言的臉會被蓋上開心的張嘴） */
const NO_LIPSYNC: PetStateId[] = ['eyeroll', 'sigh', 'nervous', 'shy', 'smirk'];

type Mouth = 'closed' | 'half' | 'open';

/**
 * 對嘴：說話時依語音音量切換「閉 / 半開 / 全開」三種嘴型（galgame 的口パク）。
 * 沒在說話時回到原本的張嘴笑（立繪本身的嘴）。
 */
function useMouth(talking: boolean): Mouth {
  const [mouth, setMouth] = useState<Mouth>('open');
  useEffect(() => {
    if (!talking) {
      setMouth('open');
      return;
    }
    let raf = 0;
    let current: Mouth = 'closed';
    let changedAt = 0;
    let level = 0;
    setMouth('closed');
    const tick = (now: number) => {
      // 開得快、闔得慢一點，看起來比較像在講話而不是在抖
      const target = voiceService.getMouthLevel();
      level = target > level ? level + (target - level) * 0.6 : level + (target - level) * 0.35;
      const next: Mouth = level > 0.6 ? 'open' : level > 0.22 ? 'half' : 'closed';
      // 每種嘴型至少停 70ms，避免一秒閃幾十次
      if (next !== current && now - changedAt > 70) {
        current = next;
        changedAt = now;
        setMouth(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [talking]);
  return mouth;
}

/** 這些狀態整段都用 Gemini 畫的彎彎笑眼（取代以前畫上去的「^^」配件） */
const SMILE_EYES: PetStateId[] = ['happy', 'patting'];

/** 分圖層立繪已經有真的表情，這些舊的「畫上去」的臉部配件就不用再疊了 */
const LAYERED_REPLACES_ACCESSORIES = [
  'happyEyes',
  // 情境姿勢的立繪已經畫了這些道具
  'headphones',
  'controller',
  'glasses',
  'hologram',
  'notebook',
  'phone',
  'lineBubble',
  'desk',
  'drool',
  'sparkleEyes',
];

/** 換成情境／情緒立繪的狀態，臉上畫的配件全部拿掉（立繪本身已經有表情了） */
const FACE_ACCESSORIES = ['blush', 'pout', 'tears', 'smugEyes', 'happyEyes', 'sparkleEyes', 'drool'];

/** 用分圖層立繪時，要疊的舊配件（被真立繪取代的拿掉） */
export function layeredAccessories<T extends string>(state: PetStateId, ids: T[]): T[] {
  return ids.filter(
    (a) => !LAYERED_REPLACES_ACCESSORIES.includes(a) && !(POSE_BODY[state] && FACE_ACCESSORIES.includes(a))
  );
}

/** 尾巴的擺法跟著心情：開心搖很快、難過垂著慢慢晃 */
const TAIL_STYLE: Partial<Record<PetStateId, string>> = {
  happy: 'pet-tail-fast',
  eating: 'pet-tail-fast',
  tired: 'pet-tail-droop',
  exhausted: 'pet-tail-droop',
  rainy: 'pet-tail-flick',
  sigh: 'pet-tail-droop',
  shy: 'pet-tail-droop',
  nervous: 'pet-tail-fast',
  smirk: 'pet-tail-fast',
  loving: 'pet-tail-fast',
  proud: 'pet-tail-fast',
  patting: 'pet-tail-fast',
  angry: 'pet-tail-flick',
  sad: 'pet-tail-droop',
  hungry: 'pet-tail-droop',
};

/** 隨機眨眼：每 2.5～6 秒眨一次，偶爾連眨兩下 */
function useBlink(): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const blinkOnce = (then: () => void) => {
      setClosed(true);
      timer = setTimeout(() => {
        if (!alive) return;
        setClosed(false);
        then();
      }, 120);
    };
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        const double = Math.random() < 0.2;
        blinkOnce(() => {
          if (double) timer = setTimeout(() => alive && blinkOnce(schedule), 160);
          else schedule();
        });
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return closed;
}

const layerClass = 'absolute inset-0 w-full h-full object-contain select-none pointer-events-none';

// 一啟動就把所有立繪先載好、而且留著（以前載完就丟，瀏覽器可能把解碼好的圖清掉，換姿勢時又要重新解碼 → 空一下）
const preloaded = new Map<string, HTMLImageElement>();
function preload(src: string): HTMLImageElement {
  let img = preloaded.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    img.decode?.().catch(() => {});
    preloaded.set(src, img);
  }
  return img;
}
const isReady = (src: string) => {
  const img = preloaded.get(src);
  return !!img && img.complete && img.naturalWidth > 0;
};
if (typeof window !== 'undefined') {
  const all = new Set<string>([
    ...Object.values(LAYERS),
    ...(Object.values(POSE_BODY) as string[]),
    ...(Object.values(POSE_OVERLAY) as string[]),
    ...(Object.values(POSE_BLINK) as string[]),
  ]);
  all.forEach(preload);
}

/** 上一次真的顯示出來的身體立繪（換姿勢時整組會重新掛載，用這個接住，新圖還沒好之前先顯示舊的） */
let lastShownBody = LAYERS.body;

/**
 * 身體立繪：
 *  - 新姿勢的圖已經解碼好 → 直接換
 *  - 還沒好 → 先繼續顯示上一張（不會整個不見），解碼好再換；最多等 1.5 秒
 *  - 載入失敗 → 退回基本立繪
 */
const BodyImage: React.FC<{ src: string }> = ({ src }) => {
  const [shown, setShown] = useState<string>(() => (isReady(src) ? src : lastShownBody));
  const [failed, setFailed] = useState<string | null>(null);
  const target = failed === src ? LAYERS.body : src;

  useEffect(() => {
    if (shown === target) return;
    if (isReady(target)) {
      setShown(target);
      return;
    }
    let alive = true;
    const img = preload(target);
    const done = () => alive && setShown(target);
    const timer = window.setTimeout(done, 1500);
    (img.decode ? img.decode() : Promise.resolve())
      .then(done)
      .catch(() => {
        if (!alive) return;
        if (target !== LAYERS.body) {
          console.warn('[立繪] 載入失敗，改用基本立繪：', target);
          setFailed(target);
        } else done();
      });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [target, shown]);

  useEffect(() => {
    lastShownBody = shown;
  }, [shown]);

  return (
    <img
      src={shown}
      alt="雙子星貓・西雅"
      draggable={false}
      decoding="sync"
      className={layerClass}
      onError={() => {
        if (shown !== LAYERS.body) {
          console.warn('[立繪] 載入失敗，改用基本立繪：', shown);
          setFailed(shown);
          setShown(LAYERS.body);
        }
      }}
    />
  );
};

export const LayeredSprite: React.FC<{ state: PetStateId; filter?: string; isTalking?: boolean }> = ({
  state,
  filter,
  isTalking = false,
}) => {
  const blinking = useBlink();
  const rawMouth = useMouth(isTalking);
  // 嘴本身是表情一部分的姿勢：閉嘴時用姿勢自己的嘴，張嘴一律用半開
  const ownMouth = OWN_MOUTH.includes(state);
  const mouth: Mouth = NO_LIPSYNC.includes(state)
    ? 'open'
    : ownMouth && isTalking
      ? rawMouth === 'closed'
        ? 'open'
        : 'half'
      : rawMouth;
  const ownBlink = POSE_BLINK[state];
  const showBlink = ownBlink ? blinking : !NO_BLINK.includes(state) && (blinking || SMILE_EYES.includes(state));
  return (
    <div className="absolute inset-0" style={{ filter, transition: 'filter 0.4s ease' }}>
      <img src={LAYERS.tail} alt="" draggable={false} className={`${layerClass} pet-tail ${TAIL_STYLE[state] ?? ''}`} />
      <BodyImage src={POSE_BODY[state] ?? LAYERS.body} />
      <img src={LAYERS.mouthHalf} alt="" draggable={false} className={layerClass} style={{ opacity: mouth === 'half' ? 1 : 0 }} />
      <img src={LAYERS.mouthClosed} alt="" draggable={false} className={layerClass} style={{ opacity: mouth === 'closed' ? 1 : 0 }} />
      <img
        src={ownBlink ?? LAYERS.eyesClosed}
        alt=""
        draggable={false}
        className={layerClass}
        style={{ opacity: showBlink ? 1 : 0 }}
      />
      {POSE_OVERLAY[state] && <img src={POSE_OVERLAY[state]} alt="" draggable={false} className={layerClass} />}
    </div>
  );
};
