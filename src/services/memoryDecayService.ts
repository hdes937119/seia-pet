import { MemoryKeyword } from '../types';

const STORAGE_KEY = 'gemini_twin_cat_memories';

// Initial default memories for the user's desktop companion
const INITIAL_MEMORIES: MemoryKeyword[] = [
  {
    id: 'mem_1',
    keyword: 'Steam 遊戲愛好者',
    category: 'game',
    frequency: 5,
    strength: 95,
    lastMentioned: Date.now() - 3600000,
    isPermanent: true,
    notes: '主人經常玩 PC 遊戲，操作很秀偶爾下飯',
  },
  {
    id: 'mem_2',
    keyword: '喜歡邊吃邊看搞笑短片',
    category: 'habit',
    frequency: 4,
    strength: 85,
    lastMentioned: Date.now() - 7200000,
    isPermanent: true,
    notes: '最愛下飯神劇，追劇時討厭被劇透',
  },
  {
    id: 'mem_3',
    keyword: 'LINE 工作多常摸魚',
    category: 'habit',
    frequency: 2,
    strength: 55,
    lastMentioned: Date.now() - 18000000,
    isPermanent: false,
    notes: '收到訊息偶爾會放著先打完這把再回',
  },
  {
    id: 'mem_4',
    keyword: '深夜常常熬夜',
    category: 'habit',
    frequency: 3,
    strength: 65,
    lastMentioned: Date.now() - 25000000,
    isPermanent: false,
    notes: '一過 12 點精神反而更好，需要貓貓提醒睡覺',
  },
];

class MemoryDecayService {
  private memories: MemoryKeyword[] = [];
  private listeners: Array<(memories: MemoryKeyword[]) => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.memories = JSON.parse(saved);
      } else {
        this.memories = INITIAL_MEMORIES;
        this.saveToStorage();
      }
    } catch {
      this.memories = INITIAL_MEMORIES;
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.memories));
      this.notifyListeners();
    } catch (e) {
      console.warn('Failed to save memories to storage:', e);
    }
  }

  public subscribe(listener: (memories: MemoryKeyword[]) => void): () => void {
    this.listeners.push(listener);
    listener([...this.memories]);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener([...this.memories]);
    }
  }

  public getMemories(): MemoryKeyword[] {
    return [...this.memories];
  }

  public getPermanentMemories(): MemoryKeyword[] {
    return this.memories.filter((m) => m.isPermanent);
  }

  public getActiveKeywords(): MemoryKeyword[] {
    return this.memories.filter((m) => !m.isPermanent && m.strength > 20);
  }

  // Reinforces an existing keyword or adds a new one
  public reinforceKeyword(
    keyword: string,
    category: MemoryKeyword['category'] = 'preference',
    notes?: string
  ): MemoryKeyword {
    const trimmed = keyword.trim();
    if (!trimmed) throw new Error('Keyword cannot be empty');

    const now = Date.now();
    const existingIndex = this.memories.findIndex(
      (m) => m.keyword.toLowerCase() === trimmed.toLowerCase()
    );

    if (existingIndex >= 0) {
      const item = { ...this.memories[existingIndex] };
      item.frequency += 1;
      item.strength = Math.min(100, item.strength + 25);
      item.lastMentioned = now;
      item.lastDecayAt = now;
      if (notes) item.notes = notes;

      // Check promotion to permanent notebook
      if (item.frequency >= 4 || item.strength >= 80) {
        item.isPermanent = true;
      }

      this.memories[existingIndex] = item;
      this.saveToStorage();
      return item;
    } else {
      const newItem: MemoryKeyword = {
        id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        keyword: trimmed,
        category,
        frequency: 1,
        strength: 50,
        lastMentioned: now,
        isPermanent: false,
        notes: notes || '新發現的主人喜好',
      };
      this.memories.unshift(newItem);
      this.saveToStorage();
      return newItem;
    }
  }

  // Memory decay over time (Ebbinghaus-style), 3 points per hour since the last settlement.
  // `extraHours` lets the notebook's test button fast-forward time.
  public applyDecay(extraHours: number = 0) {
    const now = Date.now();
    const HOUR = 1000 * 60 * 60;
    const POINTS_PER_HOUR = 3;
    let hasChanges = false;

    this.memories = this.memories.map((item) => {
      if (item.isPermanent) return item; // Never decay permanent memories!

      // 只算「上次結算之後」經過的時間，重複呼叫也不會重複扣分
      const since = Math.max(item.lastMentioned, item.lastDecayAt ?? item.lastMentioned);
      const realHours = (now - since) / HOUR;
      const decayAmount = Math.floor(realHours * POINTS_PER_HOUR + extraHours * POINTS_PER_HOUR);
      if (decayAmount <= 0) return item;

      hasChanges = true;
      // 只推進實際被扣掉的時間，保留不足 1 分的餘數到下次
      const realPointsUsed = Math.floor(realHours * POINTS_PER_HOUR);
      return {
        ...item,
        strength: Math.max(0, item.strength - decayAmount),
        lastDecayAt: since + (realPointsUsed / POINTS_PER_HOUR) * HOUR,
      };
    });

    if (hasChanges) {
      this.saveToStorage();
    }
  }

  public togglePermanent(id: string) {
    const item = this.memories.find((m) => m.id === id);
    if (item) {
      item.isPermanent = !item.isPermanent;
      if (item.isPermanent) {
        item.strength = 100;
      }
      this.saveToStorage();
    }
  }

  public deleteMemory(id: string) {
    this.memories = this.memories.filter((m) => m.id !== id);
    this.saveToStorage();
  }

  public addManualPermanentMemory(keyword: string, notes: string, category: MemoryKeyword['category'] = 'preference') {
    const newItem: MemoryKeyword = {
      id: 'mem_manual_' + Date.now(),
      keyword: keyword.trim(),
      category,
      frequency: 10,
      strength: 100,
      lastMentioned: Date.now(),
      isPermanent: true,
      notes: notes.trim() || '主人手動寫入的不可撼動設定',
    };
    this.memories.unshift(newItem);
    this.saveToStorage();
  }
}

export const memoryDecayService = new MemoryDecayService();
