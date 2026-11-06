class VoiceService {
  private isEnabled: boolean = true;
  private volume: number = 0.95;
  // 語速交給 GPT-SoVITS 自己調（speed_factor，不會變調）；存在這台電腦的 localStorage
  private speed: number = VoiceService.loadSpeed();
  private speakingListener: ((speaking: boolean) => void) | null = null;
  private audioCtx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  // 對嘴用：目前這句語音的音量曲線（每 20ms 一格），播放時依播到哪裡查表
  private currentEnvelope: { data: Float32Array; step: number; peak: number } | null = null;
  private static readonly ENVELOPE_STEP = 0.02;
  private ttsAborts = new Set<AbortController>();
  // 逐句播放佇列：每一句一加入就先開始合成，播放時依序取出
  private queue: Array<Promise<string | null>> = [];
  private isPlayingQueue = false;
  // 每次 speak / stop 都會遞增，舊的 TTS 請求回來時就知道自己已經過期
  private speakToken = 0;
  // GPT-SoVITS 單獨唸很短的句子（例如連傳時第一則的「等等！」「欸？」）常常會變成一片空白或被吞掉，
  // 所以太短的句子先留著，跟下一句合併後再送去合成；等了一陣子都沒有下一句，才單獨唸。
  private static readonly MIN_SPEAK_CHARS = 6; // 不含標點的字數
  private static readonly SHORT_HOLD_MS = 3000; // 比連傳的「輸入中」最長 2.2 秒再久一點
  private heldText = '';
  private heldTimer: ReturnType<typeof setTimeout> | null = null;

  private static loadSpeed(): number {
    try {
      const v = Number(localStorage.getItem('seia-voice-speed'));
      return Number.isFinite(v) && v >= 0.8 && v <= 1.4 ? v : 1;
    } catch {
      return 1;
    }
  }

  public setSpeed(speed: number) {
    this.speed = Math.max(0.8, Math.min(1.4, speed));
    try {
      localStorage.setItem('seia-voice-speed', String(this.speed));
    } catch {
      // 存不了就只在這次有效
    }
  }

  public getSpeed(): number {
    return this.speed;
  }

  public setSpeakingListener(listener: (speaking: boolean) => void) {
    this.speakingListener = listener;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public getVolume(): number {
    return this.volume;
  }

  /** 打斷目前所有語音，改講這一段（單獨一段話，短也直接唸，不等下一句） */
  public speak(text: string) {
    this.stop();
    this.enqueueText(text, true);
  }

  /**
   * 加到播放佇列尾端（不打斷正在講的話）。
   * 串流對話時每收到完整一句就呼叫一次：第一句很快就能開口，後面的句子邊播邊合成。
   * 太短的句子會先留著，跟下一句合併再唸。
   */
  public enqueue(text: string) {
    this.enqueueText(text, false);
  }

  private enqueueText(text: string, force: boolean) {
    if (!this.isEnabled || typeof window === 'undefined') return;
    const cleanText = VoiceService.cleanForSpeech(text);
    if (!cleanText) return;
    // 只有「♪」「…」這種沒字可唸的就不送去合成（以前會單獨送出一個空請求）
    if (VoiceService.spokenLength(cleanText) === 0 && !this.heldText) return;

    const combined = VoiceService.joinSpeech(this.takeHeld(), cleanText);
    if (!force && VoiceService.spokenLength(combined) < VoiceService.MIN_SPEAK_CHARS) {
      this.hold(combined);
      return;
    }
    this.pushToQueue(combined);
  }

  private pushToQueue(text: string) {
    this.queue.push(this.synthesize(text, this.speakToken));
    if (!this.isPlayingQueue) void this.playQueue(this.speakToken);
  }

  /** 先留著短句；時間到了還沒有下一句，就單獨唸出來 */
  private hold(text: string) {
    this.heldText = text;
    if (this.heldTimer) clearTimeout(this.heldTimer);
    const token = this.speakToken;
    this.heldTimer = setTimeout(() => {
      this.heldTimer = null;
      if (token !== this.speakToken) return;
      const t = this.takeHeld();
      if (t) this.pushToQueue(t);
    }, VoiceService.SHORT_HOLD_MS);
  }

  private takeHeld(): string {
    if (this.heldTimer) {
      clearTimeout(this.heldTimer);
      this.heldTimer = null;
    }
    const t = this.heldText;
    this.heldText = '';
    return t;
  }

  /** 不含標點、空白、符號的字數 */
  private static spokenLength(text: string) {
    return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
  }

  /** 合併兩句：前一句沒有句尾標點就補一個逗號，唸起來才會有停頓 */
  private static joinSpeech(a: string, b: string) {
    if (!a) return b;
    return /[。！？!?…～~，,、♪]$/.test(a) ? `${a}${b}` : `${a}，${b}`;
  }

  // 濾水器：清空特殊符號、隱藏標記與網址
  private static cleanForSpeech(text: string) {
    return text
      .replace(/\[\[[^\]]*\]\]/g, ' ') // [[NEXT]]、[[STICKER:…]] 這類節奏標記不唸
      .replace(/[*#_`~\[\]\(\)>✦🐾]/g, ' ')
      .replace(/<!--[\s\S]*?(-->|$)/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim();
  }

  /** 呼叫後端 GPT-SoVITS 合成一句，回傳 base64 WAV；失敗或被打斷回傳 null */
  private async synthesize(text: string, token: number): Promise<string | null> {
    const controller = new AbortController();
    this.ttsAborts.add(controller);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speed: this.speed }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`後端拒絕連線，狀態碼: ${response.status}`);
      const data = await response.json();
      if (token !== this.speakToken) return null;
      return data?.audioBase64 || null;
    } catch (error: any) {
      if (error?.name !== 'AbortError' && token === this.speakToken) {
        console.error('[前端] 呼叫無月聲帶失敗:', error);
      }
      return null;
    } finally {
      this.ttsAborts.delete(controller);
    }
  }

  /**
   * 對嘴用：把同一段音檔另外解碼一次，算出每 20ms 的音量（不經過播放的路徑，分析失敗也只是嘴巴不動）
   */
  private async computeEnvelope(base64: string) {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioContextClass();
      }
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const buf = await this.audioCtx.decodeAudioData(bytes.buffer);
      const ch = buf.getChannelData(0);
      const win = Math.max(1, Math.round(buf.sampleRate * VoiceService.ENVELOPE_STEP));
      const data = new Float32Array(Math.ceil(ch.length / win));
      for (let i = 0; i < data.length; i++) {
        let sum = 0;
        const end = Math.min(ch.length, (i + 1) * win);
        for (let j = i * win; j < end; j++) sum += ch[j] * ch[j];
        data[i] = Math.sqrt(sum / Math.max(1, end - i * win));
      }
      // 用第 90 百分位當「張到最大」的音量，每句話的大小聲不同也能對得上
      const sorted = Array.from(data).sort((a, b) => a - b);
      const peak = Math.max(sorted[Math.floor(sorted.length * 0.9)] || 0, 0.01);
      return { data, step: VoiceService.ENVELOPE_STEP, peak };
    } catch {
      return null;
    }
  }

  /** 對嘴用：目前語音的音量（0 = 沒聲音，1 ≈ 這句話裡比較大聲的地方） */
  public getMouthLevel(): number {
    const audio = this.currentAudio;
    const env = this.currentEnvelope;
    if (!audio || !env || audio.paused) return 0;
    const v = env.data[Math.floor(audio.currentTime / env.step)] ?? 0;
    return Math.min(1.5, v / env.peak);
  }

  private async playAudio(base64: string, token: number): Promise<void> {
    const envelope = await this.computeEnvelope(base64);
    return new Promise((resolve) => {
      if (token !== this.speakToken) return resolve();
      const audio = new Audio(`data:audio/wav;base64,${base64}`);
      audio.volume = this.volume;
      this.currentAudio = audio;
      this.currentEnvelope = envelope;
      const done = () => {
        if (this.currentAudio === audio) {
          this.currentAudio = null;
          this.currentEnvelope = null;
        }
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done; // stop() 會 pause
      audio.play().catch(done);
    });
  }

  private async playQueue(token: number) {
    this.isPlayingQueue = true;
    if (this.speakingListener) this.speakingListener(true);
    try {
      while (this.queue.length > 0 && token === this.speakToken) {
        const base64 = await this.queue.shift()!;
        if (token !== this.speakToken) return;
        if (base64) await this.playAudio(base64, token);
      }
    } finally {
      // 被 stop() 打斷時，stop() 已經處理好狀態，這裡不要覆蓋新的播放
      if (token === this.speakToken) {
        this.isPlayingQueue = false;
        if (this.speakingListener) this.speakingListener(false);
      }
    }
  }

  public stop() {
    this.speakToken++;
    this.takeHeld();
    this.queue = [];
    this.isPlayingQueue = false;
    this.ttsAborts.forEach((c) => c.abort());
    this.ttsAborts.clear();
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // ignore
      }
      this.activeSource = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.speakingListener) this.speakingListener(false);
  }
}

export const voiceService = new VoiceService();
