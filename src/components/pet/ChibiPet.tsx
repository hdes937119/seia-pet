import React from 'react';
import { BASE_SPRITE, PET_SPRITES, PET_STATES, type PetStateId, type SpriteAsset } from './petStates';
import { PetAccessories, PetAura, PetParticles } from './PetEffects';
import { HeadPatZone } from './HeadPatZone';

/**
 * 雙子星貓 chibi 動態桌寵。
 * 依 state 切換：身體動畫 + 逐格素材（若有）+ 配件 + 粒子特效 + 光暈。
 * 狀態改變時整組重新播放進場動畫，達到「切換幀動畫」的效果。
 */

interface ChibiPetProps {
  state: PetStateId;
  isTalking?: boolean;
  /** 按住頭部（摸頭）開始 / 結束 */
  onHeadPressStart?: () => void;
  onHeadPressEnd?: () => void;
  showLabel?: boolean;
}

const SpriteImage: React.FC<{ asset?: SpriteAsset; filter?: string }> = ({ asset, filter }) => {
  const src = asset?.src ?? BASE_SPRITE;
  const frames = asset?.frames ?? 1;
  const style: React.CSSProperties = { filter, transition: 'filter 0.4s ease' };

  if (frames > 1) {
    // 橫向 Sprite sheet：圖片寬 = 幀數 × 容器寬，用 steps() 一格一格平移
    const fps = asset?.fps ?? 10;
    return (
      <div className="absolute inset-0 overflow-hidden" style={style}>
        <img
          src={src}
          alt="雙子星貓"
          draggable={false}
          className="h-full max-w-none select-none"
          style={{
            width: `${frames * 100}%`,
            animation: `pet-sprite-steps ${(frames / fps).toFixed(2)}s steps(${frames}) infinite`,
          }}
        />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="雙子星貓"
      draggable={false}
      className="absolute inset-0 w-full h-full object-contain select-none"
      style={style}
    />
  );
};

export const ChibiPet: React.FC<ChibiPetProps> = ({
  state,
  isTalking = false,
  onHeadPressStart,
  onHeadPressEnd,
  showLabel = true,
}) => {
  const config = PET_STATES[state] ?? PET_STATES.idle;
  const sprite = PET_SPRITES[state];

  return (
    <div
      className="relative h-full aspect-[3/4] mx-auto select-none"
      style={{ containerType: 'inline-size' }}
    >
      {/* 光暈與背後配件（不跟身體動） */}
      <div key={`aura-${state}`} className="pet-enter absolute inset-0">
        <PetAura aura={config.aura} />
        <PetAccessories ids={config.accessories} layer="back" />
      </div>

      {/* 身體：狀態動畫 → 說話時的小幅彈動 → 立繪 + 貼身配件 */}
      <div key={`body-${state}`} className={`absolute inset-0 z-10 pet-body ${config.bodyAnim}`}>
        <div className={`absolute inset-0 pet-body ${isTalking ? 'pet-anim-talk' : ''}`}>
          <SpriteImage asset={sprite} filter={config.filter} />
          <div className="pet-enter absolute inset-0">
            <PetAccessories ids={config.accessories} layer="attached" />
          </div>
        </div>
      </div>

      {/* 前景固定配件與粒子特效 */}
      <div key={`fx-${state}`} className="pet-enter absolute inset-0 z-20 pointer-events-none">
        <PetAccessories ids={config.accessories} layer="static" />
        <PetParticles specs={config.particles} stateKey={state} />
      </div>

      {/* 頭部感應區：按住是摸頭；輕點照常打開對話框 */}
      <HeadPatZone
        onStart={onHeadPressStart}
        onEnd={onHeadPressEnd}
        className="left-[12%] top-[2%] w-[55%] h-[38%]"
      />

      {showLabel && (
        <div className="absolute z-40 bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-950/75 border border-purple-400/40 text-purple-100 whitespace-nowrap">
          {config.emoji} {config.label}
        </div>
      )}
    </div>
  );
};
