/**
 * 真實天象 → 河木鎮的特殊觀測夜。
 *
 * 只收「每年日期固定」的主要流星雨極大期（日期每年差不到一天，所以寫死也準）。
 * 日食、月食、行星合月每年不同，需要可靠的資料來源才加，免得她講錯。
 * 雙子座流星雨是「雙子星貓」一年一度最重要的觀測夜。
 */

export interface SkyEvent {
  name: string;
  /** 極大期那一晚的日期（月、日；那天晚上到隔天清晨） */
  month: number;
  day: number;
  major?: boolean;
  note: string;
}

export const SKY_EVENTS: SkyEvent[] = [
  { name: '象限儀座流星雨', month: 1, day: 3, note: '一年的第一場大流星雨，極大期很短' },
  { name: '天琴座流星雨', month: 4, day: 22, note: '有記錄的流星雨裡最古老的之一' },
  { name: '寶瓶座 η 流星雨', month: 5, day: 5, note: '來自哈雷彗星的碎屑，清晨最好看' },
  { name: '英仙座流星雨', month: 8, day: 12, note: '夏天最熱門的流星雨，數量多又穩定' },
  { name: '獵戶座流星雨', month: 10, day: 21, note: '也是哈雷彗星的碎屑，流星速度很快' },
  { name: '獅子座流星雨', month: 11, day: 17, note: '速度最快的流星雨之一，偶爾會大爆發' },
  { name: '雙子座流星雨', month: 12, day: 13, major: true, note: '一年中最壯觀的流星雨，也是雙子星貓一年一度最重要的觀測夜' },
  { name: '小熊座流星雨', month: 12, day: 22, note: '冬至前後、一年最後一場' },
];

const HOUR = 60 * 60 * 1000;
/** 觀測夜：那天 20:00 到隔天 05:00 */
const NIGHT_START_H = 20;
const NIGHT_END_H = 5;

/** 這一天晚上是不是特殊觀測夜 */
export function skyEventOn(ms: number): SkyEvent | null {
  const d = new Date(ms);
  return SKY_EVENTS.find((e) => e.month === d.getMonth() + 1 && e.day === d.getDate()) || null;
}

/** 這個時間點是不是在特殊觀測夜裡（回傳那一場） */
export function inObservationNight(ms: number): SkyEvent | null {
  const d = new Date(ms);
  const h = d.getHours();
  if (h >= NIGHT_START_H) return skyEventOn(ms);
  if (h < NIGHT_END_H) return skyEventOn(ms - 12 * HOUR);
  return null;
}

/** 今晚的觀測夜（白天就能知道，好讓她先跟主人說） */
export function tonightEvent(ms: number): SkyEvent | null {
  const h = new Date(ms).getHours();
  return h < NIGHT_END_H ? skyEventOn(ms - 12 * HOUR) : skyEventOn(ms);
}

/** 接下來幾天內的觀測夜（給說書人鋪陳：鎮上開始準備） */
export function upcomingEvent(ms: number, days = 3): { event: SkyEvent; inDays: number } | null {
  for (let i = 1; i <= days; i++) {
    const e = skyEventOn(ms + i * 24 * HOUR);
    if (e) return { event: e, inDays: i };
  }
  return null;
}

export const OBSERVATION_START_H = NIGHT_START_H;
export const OBSERVATION_END_H = NIGHT_END_H;
