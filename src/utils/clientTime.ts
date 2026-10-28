/** 主人的當地時間（送給後端，讓貓貓有「時間感」：早安、吃飯、該睡了） */
export interface ClientTime {
  label: string; // 例如「星期三 晚上 11:42」
  hour: number;
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function periodOf(hour: number): string {
  if (hour < 5) return '深夜';
  if (hour < 9) return '早上';
  if (hour < 11) return '上午';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  if (hour < 23) return '晚上';
  return '深夜';
}

export function getClientTime(now = new Date()): ClientTime {
  const hour = now.getHours();
  const hh = String(hour).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return { label: `${WEEKDAYS[now.getDay()]} ${periodOf(hour)} ${hh}:${mm}`, hour };
}
