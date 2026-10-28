import React, { useMemo } from 'react';
import type { AccessoryId, AuraId, ParticleArea, ParticleKind, ParticleSpec } from './petStates';

/**
 * 立繪座標（以 public/pet/gemini-chibi.png 420×560 為準）。
 * 換底圖時只要改這裡，配件和粒子就會跟著對齊。
 */
export const SPRITE_W = 420;
export const SPRITE_H = 560;
const P = {
  ahoge: [135, 25],
  earL: [63, 80],
  earR: [245, 65],
  eyeL: [140, 190],
  eyeR: [195, 185],
  cheekL: [117, 216],
  cheekR: [219, 211],
  mouth: [165, 226],
  chest: [165, 300],
  handR: [325, 268],
} as const;

// 粒子出現的範圍（x1, y1, x2, y2，單位同上）
const AREAS: Record<ParticleArea, [number, number, number, number]> = {
  head: [50, 40, 290, 150],
  ears: [20, 30, 300, 150],
  around: [10, 50, 410, 510],
  above: [175, 20, 280, 70],
  body: [80, 260, 260, 450],
};

// 固定的偽亂數：同一個狀態每次渲染位置都一樣，不會一直跳動
function seeded(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/* ─────────────────────────── 光暈 ─────────────────────────── */

export const PetAura: React.FC<{ aura?: AuraId }> = ({ aura }) => {
  if (!aura) return null;
  if (aura === 'rays') {
    return (
      <div className="pointer-events-none absolute inset-[-10%] flex items-center justify-center">
        <div className="pet-aura-rays w-[120%] aspect-square rounded-full" />
      </div>
    );
  }
  const color: Record<Exclude<AuraId, 'rays'>, string> = {
    pink: 'rgba(244,114,182,0.45)',
    gold: 'rgba(250,204,21,0.38)',
    blue: 'rgba(56,189,248,0.40)',
    violet: 'rgba(139,92,246,0.45)',
    green: 'rgba(6,199,85,0.30)',
    gloom: 'rgba(30,41,90,0.65)',
  };
  return (
    <div
      className="pet-aura-pulse pointer-events-none absolute inset-0 rounded-full"
      style={{ background: `radial-gradient(circle at 45% 40%, ${color[aura]} 0%, transparent 65%)` }}
    />
  );
};

/* ─────────────────────────── 粒子 ─────────────────────────── */

const FourPointStar: React.FC<{ color: string }> = ({ color }) => (
  <svg viewBox="0 0 20 20" className="w-full h-full" style={{ filter: `drop-shadow(0 0 3px ${color})` }}>
    <path d="M10 0 L12.2 7.8 L20 10 L12.2 12.2 L10 20 L7.8 12.2 L0 10 L7.8 7.8 Z" fill={color} />
  </svg>
);

const Heart: React.FC = () => (
  <svg viewBox="0 0 24 22" className="w-full h-full" style={{ filter: 'drop-shadow(0 0 3px #f472b6)' }}>
    <path
      d="M12 21 C 5 15, 0 11, 0 6 C 0 2.5, 2.8 0, 6 0 C 8.3 0, 10.6 1.3, 12 3.4 C 13.4 1.3, 15.7 0, 18 0 C 21.2 0, 24 2.5, 24 6 C 24 11, 19 15, 12 21 Z"
      fill="#f9a8d4"
      stroke="#ec4899"
      strokeWidth="1.5"
    />
  </svg>
);

const AngerMark: React.FC = () => (
  <svg viewBox="0 0 40 40" className="w-full h-full" style={{ filter: 'drop-shadow(0 0 2px #fff)' }}>
    {[0, 90, 180, 270].map((r) => (
      <path
        key={r}
        d="M 14 4 Q 17 14 6 15"
        fill="none"
        stroke="#ef4444"
        strokeWidth="5"
        strokeLinecap="round"
        transform={`rotate(${r} 20 20)`}
      />
    ))}
  </svg>
);

function renderParticle(kind: ParticleKind, i: number) {
  switch (kind) {
    case 'heart':
      return <Heart />;
    case 'note':
      return <span className="text-violet-300 font-bold drop-shadow-[0_0_4px_#a78bfa]">{i % 2 ? '♪' : '♫'}</span>;
    case 'sparkle':
      return <FourPointStar color={i % 3 === 0 ? '#fde68a' : i % 3 === 1 ? '#e0e7ff' : '#f0abfc'} />;
    case 'rain':
      return <div className="w-[3px] h-full rounded-full bg-gradient-to-b from-transparent to-sky-300/90" />;
    case 'question':
      return <span className="font-black text-amber-300 drop-shadow-[0_0_4px_#7c3aed]">?</span>;
    case 'anger':
      return <AngerMark />;
    case 'gloom':
      return <div className="w-[3px] h-full bg-gradient-to-b from-indigo-950/90 to-transparent" />;
    case 'speech':
      return (
        <span className="flex items-center justify-center w-full h-full rounded-full bg-white/95 text-[0.8em] shadow-lg">
          💬
        </span>
      );
    case 'exclaim':
      return <span className="font-black text-rose-400 drop-shadow-[0_0_4px_#fff]">！</span>;
  }
}

// 每種粒子的大小（佔立繪寬度 %）與動畫
const PARTICLE_STYLE: Record<ParticleKind, { size: number; tall?: number; anim: string; dur: [number, number] }> = {
  heart: { size: 7, anim: 'pet-p-rise', dur: [1.8, 2.8] },
  note: { size: 7, anim: 'pet-p-rise-sway', dur: [2.0, 3.0] },
  sparkle: { size: 5, anim: 'pet-p-twinkle', dur: [1.4, 2.4] },
  rain: { size: 1.5, tall: 5, anim: 'pet-p-fall', dur: [0.9, 1.5] },
  question: { size: 10, anim: 'pet-p-question', dur: [1.6, 2.2] },
  anger: { size: 11, anim: 'pet-p-throb', dur: [0.7, 0.9] },
  gloom: { size: 1.2, tall: 10, anim: 'pet-p-gloom', dur: [2.2, 3.2] },
  speech: { size: 11, anim: 'pet-p-pop', dur: [2.4, 2.4] },
  exclaim: { size: 9, anim: 'pet-p-pop', dur: [1.8, 2.6] },
};

export const PetParticles: React.FC<{ specs: ParticleSpec[]; stateKey: string }> = ({ specs, stateKey }) => {
  const items = useMemo(() => {
    const out: Array<{ key: string; kind: ParticleKind; style: React.CSSProperties; i: number }> = [];
    let seed = stateKey.length * 17;
    specs.forEach((spec, si) => {
      const [x1, y1, x2, y2] = AREAS[spec.area];
      const look = PARTICLE_STYLE[spec.kind];
      for (let i = 0; i < spec.count; i++) {
        seed++;
        const x = x1 + seeded(seed) * (x2 - x1);
        const y = y1 + seeded(seed + 101) * (y2 - y1);
        const dur = look.dur[0] + seeded(seed + 7) * (look.dur[1] - look.dur[0]);
        out.push({
          key: `${si}-${i}`,
          kind: spec.kind,
          i,
          style: {
            left: `${(x / SPRITE_W) * 100}%`,
            top: `${(y / SPRITE_H) * 100}%`,
            width: `${look.size}%`,
            height: look.tall ? `${look.tall}%` : undefined,
            aspectRatio: look.tall ? undefined : '1 / 1',
            fontSize: `${look.size * 0.9}cqw`,
            animation: `${look.anim} ${dur.toFixed(2)}s ease-in-out ${(-seeded(seed + 3) * dur).toFixed(2)}s infinite`,
          },
        });
      }
    });
    return out;
  }, [specs, stateKey]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {items.map((p) => (
        <div
          key={p.key}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center leading-none"
          style={p.style}
        >
          {renderParticle(p.kind, p.i)}
        </div>
      ))}
    </div>
  );
};

/* ─────────────────────────── 配件 ─────────────────────────── */

/**
 * 配件圖層：
 *  back     → 在角色後面、不跟身體動（LINE 大對話框）
 *  static   → 在角色前面、不跟身體動（桌子：貓貓趴在桌邊探頭）
 *  attached → 貼在角色身上，跟著身體動畫一起動（眼鏡、耳機、腮紅…）
 */
export type AccessoryLayer = 'back' | 'static' | 'attached';
const LAYER_OF: Partial<Record<AccessoryId, AccessoryLayer>> = {
  lineBubble: 'back',
  desk: 'static',
};

const SKIN = '#fde7e2';
const LINE = '#3b1f4a';

function renderAccessory(id: AccessoryId) {
  const [lx, ly] = P.eyeL;
  const [rx, ry] = P.eyeR;
  switch (id) {
    case 'blush':
      return (
        <g key={id} className="pet-blush" opacity={0.85}>
          {[P.cheekL, P.cheekR].map(([cx, cy], k) => (
            <g key={k}>
              <ellipse cx={cx} cy={cy} rx={20} ry={9} fill="#fb7185" opacity={0.55} filter="url(#pet-soft)" />
              {[-8, 0, 8].map((dx) => (
                <line key={dx} x1={cx + dx - 3} y1={cy + 4} x2={cx + dx + 3} y2={cy - 4} stroke="#e11d48" strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
              ))}
            </g>
          ))}
        </g>
      );
    case 'happyEyes': // 彎彎眼 ^^
      return (
        <g key={id}>
          {[P.eyeL, P.eyeR].map(([cx, cy], k) => (
            <g key={k}>
              <ellipse cx={cx} cy={cy} rx={23} ry={25} fill={SKIN} />
              <path d={`M ${cx - 16} ${cy + 6} Q ${cx} ${cy - 14} ${cx + 16} ${cy + 6}`} fill="none" stroke={LINE} strokeWidth={5} strokeLinecap="round" />
            </g>
          ))}
        </g>
      );
    case 'smugEyes': // 半瞇得意眼
      return (
        <g key={id}>
          {[P.eyeL, P.eyeR].map(([cx, cy], k) => (
            <g key={k}>
              <path d={`M ${cx - 24} ${cy - 26} L ${cx + 24} ${cy - 26} L ${cx + 24} ${cy - 2} Q ${cx} ${cy + 4} ${cx - 24} ${cy - 2} Z`} fill={SKIN} />
              <path d={`M ${cx - 20} ${cy - 1} Q ${cx} ${cy + 5} ${cx + 20} ${cy - 1}`} fill="none" stroke={LINE} strokeWidth={4.5} strokeLinecap="round" />
            </g>
          ))}
        </g>
      );
    case 'sparkleEyes': // 閃亮期待眼
      return (
        <g key={id} className="pet-twinkle">
          {[P.eyeL, P.eyeR].map(([cx, cy], k) => (
            <g key={k}>
              <path d={`M ${cx} ${cy - 15} L ${cx + 4} ${cy - 4} L ${cx + 15} ${cy} L ${cx + 4} ${cy + 4} L ${cx} ${cy + 15} L ${cx - 4} ${cy + 4} L ${cx - 15} ${cy} L ${cx - 4} ${cy - 4} Z`} fill="#fff" opacity={0.95} />
              <circle cx={cx - 9} cy={cy + 10} r={3.5} fill="#fff" />
            </g>
          ))}
        </g>
      );
    case 'tears':
      return (
        <g key={id}>
          {[
            [lx - 4, ly + 22],
            [rx + 6, ry + 22],
          ].map(([cx, cy], k) => (
            <g key={k}>
              <ellipse cx={cx} cy={cy - 6} rx={18} ry={5} fill="#7dd3fc" opacity={0.75} />
              <path className="pet-tear" style={{ animationDelay: `${k * 0.6}s` }} d={`M ${cx} ${cy} q -5 9 0 13 q 5 -4 0 -13 Z`} fill="#38bdf8" stroke="#e0f2fe" strokeWidth={1} />
            </g>
          ))}
        </g>
      );
    case 'drool': {
      const [mx, my] = P.mouth;
      return (
        <path key={id} className="pet-drool" d={`M ${mx + 14} ${my + 4} q -5 10 0 16 q 5 -6 0 -16 Z`} fill="#bae6fd" stroke="#7dd3fc" strokeWidth={1} />
      );
    }
    case 'pout': {
      const [mx, my] = P.mouth;
      const [cx, cy] = P.cheekR;
      return (
        <g key={id}>
          <ellipse cx={mx} cy={my} rx={15} ry={12} fill={SKIN} />
          <path d={`M ${mx - 8} ${my + 2} q 4 -6 8 0 q 4 -6 8 0`} fill="none" stroke={LINE} strokeWidth={3} strokeLinecap="round" />
          <circle className="pet-puff" cx={cx + 4} cy={cy + 2} r={16} fill="#fecdd3" opacity={0.75} />
        </g>
      );
    }
    case 'headphones':
      return (
        <g key={id} style={{ filter: 'drop-shadow(0 0 6px #8b5cf6)' }}>
          <path d="M 70 190 C 55 70, 250 30, 262 172" fill="none" stroke="#4c1d95" strokeWidth={13} strokeLinecap="round" />
          <path d="M 70 190 C 55 70, 250 30, 262 172" fill="none" stroke="#a78bfa" strokeWidth={4} strokeLinecap="round" />
          {[
            [70, 195],
            [262, 178],
          ].map(([cx, cy], k) => (
            <g key={k}>
              <rect x={cx - 20} y={cy - 28} width={40} height={56} rx={16} fill="#312e81" stroke="#c4b5fd" strokeWidth={3} />
              <rect className="pet-led" x={cx - 9} y={cy - 16} width={18} height={32} rx={8} fill="#67e8f9" opacity={0.85} />
            </g>
          ))}
          <path d="M 80 215 Q 105 250 140 238" fill="none" stroke="#4c1d95" strokeWidth={5} strokeLinecap="round" />
          <circle cx={142} cy={237} r={6} fill="#a78bfa" />
        </g>
      );
    case 'controller': {
      const [cx, cy] = P.chest;
      return (
        <g key={id} className="pet-controller" style={{ filter: 'drop-shadow(0 0 8px #8b5cf6)' }}>
          <path d={`M ${cx - 62} ${cy - 18} Q ${cx} ${cy - 34} ${cx + 62} ${cy - 18} Q ${cx + 82} ${cy + 30} ${cx + 52} ${cy + 34} Q ${cx + 30} ${cy + 36} ${cx + 18} ${cy + 16} L ${cx - 18} ${cy + 16} Q ${cx - 30} ${cy + 36} ${cx - 52} ${cy + 34} Q ${cx - 82} ${cy + 30} ${cx - 62} ${cy - 18} Z`} fill="#1e1b4b" stroke="#a78bfa" strokeWidth={3} />
          <rect x={cx - 48} y={cy - 6} width={22} height={7} rx={2} fill="#c4b5fd" />
          <rect x={cx - 40} y={cy - 14} width={7} height={22} rx={2} fill="#c4b5fd" />
          {[
            [cx + 38, cy - 10, '#f472b6'],
            [cx + 50, cy, '#facc15'],
            [cx + 38, cy + 10, '#34d399'],
            [cx + 26, cy, '#60a5fa'],
          ].map(([bx, by, col], k) => (
            <circle key={k} className="pet-button" style={{ animationDelay: `${k * 0.13}s` }} cx={bx as number} cy={by as number} r={5} fill={col as string} />
          ))}
        </g>
      );
    }
    case 'glasses':
      return (
        <g key={id} transform={`rotate(-4 ${(lx + rx) / 2} ${(ly + ry) / 2})`}>
          {[P.eyeL, P.eyeR].map(([cx, cy], k) => (
            <g key={k}>
              <circle cx={cx} cy={cy} r={27} fill="rgba(186,230,253,0.18)" stroke="#1e1b4b" strokeWidth={5} />
              <circle cx={cx} cy={cy} r={27} fill="none" stroke="#fbbf24" strokeWidth={2} />
              <path className="pet-glint" d={`M ${cx - 14} ${cy - 12} L ${cx - 4} ${cy - 20}`} stroke="#fff" strokeWidth={3} strokeLinecap="round" />
            </g>
          ))}
          <path d={`M ${lx + 27} ${ly - 2} Q ${(lx + rx) / 2} ${ly - 12} ${rx - 27} ${ry - 2}`} fill="none" stroke="#1e1b4b" strokeWidth={4} />
        </g>
      );
    case 'hologram': {
      const [hx, hy] = P.handR;
      return (
        <g key={id}>
          <g className="pet-holo" style={{ filter: 'drop-shadow(0 0 8px #38bdf8)' }}>
            <path d="M 268 120 L 412 100 L 412 222 L 268 236 Z" fill="rgba(56,189,248,0.16)" stroke="#7dd3fc" strokeWidth={2.5} />
            {[0, 1, 2, 3, 4].map((k) => (
              <rect key={k} className="pet-holo-line" style={{ animationDelay: `${k * 0.25}s` }} x={282} y={128 + k * 19} width={k % 2 ? 70 : 104} height={6} rx={3} fill="#bae6fd" opacity={0.75} />
            ))}
            <text x={372} y={128} fontSize={18} fill="#e0f2fe">✦</text>
          </g>
          <circle className="pet-led" cx={hx + 4} cy={hy - 8} r={7} fill="#7dd3fc" />
        </g>
      );
    }
    case 'notebook': {
      const [cx, cy] = P.chest;
      return (
        <g key={id} className="pet-notebook" style={{ filter: 'drop-shadow(0 0 10px #60a5fa)' }}>
          <rect x={cx - 48} y={cy - 10} width={96} height={66} rx={6} fill="#312e81" stroke="#93c5fd" strokeWidth={3} />
          <rect x={cx - 42} y={cy - 4} width={40} height={54} rx={3} fill="#eef2ff" />
          <rect x={cx + 2} y={cy - 4} width={40} height={54} rx={3} fill="#eef2ff" />
          {[0, 1, 2, 3].map((k) => (
            <rect key={k} x={cx - 37} y={cy + 4 + k * 11} width={30} height={3} rx={1.5} fill="#a5b4fc" />
          ))}
          <path d={`M ${cx + 22} ${cy + 8} l 4 10 l 10 4 l -10 4 l -4 10 l -4 -10 l -10 -4 l 10 -4 Z`} fill="#facc15" />
          <text x={cx - 40} y={cy - 14} fontSize={11} fontWeight={700} fill="#bfdbfe">AI 智慧手帳</text>
        </g>
      );
    }
    case 'phone': {
      const [cx, cy] = P.chest;
      return (
        <g key={id} className="pet-phone" transform={`rotate(-10 ${cx} ${cy})`}>
          <rect x={cx - 26} y={cy - 30} width={52} height={88} rx={9} fill="#0f172a" stroke="#e2e8f0" strokeWidth={3} />
          <rect x={cx - 21} y={cy - 22} width={42} height={70} rx={4} fill="#06C755" />
          <g className="pet-scroll">
            {[0, 1, 2, 3, 4, 5].map((k) => (
              <rect key={k} x={k % 2 ? cx - 16 : cx - 4} y={cy - 18 + k * 12} width={20} height={7} rx={3.5} fill={k % 2 ? '#ffffff' : '#dcfce7'} />
            ))}
          </g>
          <ellipse className="pet-thumb" cx={cx + 10} cy={cy + 34} rx={10} ry={13} fill="#fde7e2" stroke="#f9a8d4" strokeWidth={1.5} />
        </g>
      );
    }
    case 'lineBubble':
      return (
        <g key={id} className="pet-aura-pulse">
          <path d="M 40 110 Q 40 70 90 70 L 340 70 Q 395 70 395 120 L 395 430 Q 395 480 340 480 L 120 480 L 70 525 L 82 480 Q 40 478 40 430 Z" fill="rgba(6,199,85,0.20)" stroke="rgba(6,199,85,0.75)" strokeWidth={4} />
        </g>
      );
    case 'desk':
      return (
        <g key={id}>
          <defs>
            <linearGradient id="pet-desk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6d5aa8" />
              <stop offset="12%" stopColor="#3b2f6b" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
          </defs>
          <rect x={-10} y={372} width={440} height={200} rx={10} fill="url(#pet-desk)" stroke="#a78bfa" strokeWidth={2} />
          {[128, 206].map((px, k) => (
            <g key={k} className="pet-paw" style={{ animationDelay: `${k * 0.35}s` }}>
              <ellipse cx={px} cy={372} rx={22} ry={14} fill="#fde7e2" stroke="#f9a8d4" strokeWidth={2} />
              {[-11, 0, 11].map((dx) => (
                <circle key={dx} cx={px + dx} cy={364} r={4} fill="#f9a8d4" />
              ))}
            </g>
          ))}
          <g className="pet-steam-wrap">
            <ellipse cx={330} cy={368} rx={42} ry={10} fill="#f8fafc" />
            <path d="M 300 360 Q 330 318 360 360 Z" fill="#fff7ed" stroke="#fdba74" strokeWidth={2} />
            <path d="M 318 344 q 6 -6 12 0 q 6 -6 12 0" fill="none" stroke="#fdba74" strokeWidth={2} />
            {[312, 330, 348].map((sx, k) => (
              <path key={sx} className="pet-steam" style={{ animationDelay: `${k * 0.4}s` }} d={`M ${sx} 320 q -6 -10 0 -20 q 6 -10 0 -20`} fill="none" stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round" />
            ))}
          </g>
        </g>
      );
  }
}

export const PetAccessories: React.FC<{ ids: AccessoryId[]; layer: AccessoryLayer }> = ({ ids, layer }) => {
  const list = ids.filter((id) => (LAYER_OF[id] ?? 'attached') === layer);
  if (list.length === 0) return null;
  return (
    <svg
      viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`}
      className={`pointer-events-none absolute inset-0 w-full h-full overflow-visible ${layer === 'back' ? 'z-0' : 'z-20'}`}
    >
      <defs>
        <filter id="pet-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      {list.map(renderAccessory)}
    </svg>
  );
};
