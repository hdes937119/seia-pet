export type MoeVoiceMode = 'moe_fast' | 'ai_cloud_moe' | 'jp_seiyuu';

class VoiceService {
  private isEnabled: boolean = true;
  private volume: number = 0.95;
  private pitch: number = 1.58; // High-pitched Japanese Moe Anime timbre (1.0 - 2.0)
  private rate: number = 1.14;  // Energetic, bouncy anime girl cadence
  private voiceMode: MoeVoiceMode = 'moe_fast';
  private speakingListener: ((speaking: boolean) => void) | null = null;
  private audioCtx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private ttsAbort: AbortController | null = null;
  // 每次 speak / stop 都會遞增，舊的 TTS 請求回來時就知道自己已經過期
  private speakToken = 0;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.getBestMoeVoice();
      };
    }
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

  public setVoiceMode(mode: MoeVoiceMode) {
    this.voiceMode = mode;
  }

  public getVoiceMode(): MoeVoiceMode {
    return this.voiceMode;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public getVolume(): number {
    return this.volume;
  }

  public setPitch(pitch: number) {
    this.pitch = Math.max(0.8, Math.min(2.0, pitch));
  }

  public getPitch(): number {
    return this.pitch;
  }

  public setRate(rate: number) {
    this.rate = Math.max(0.7, Math.min(1.6, rate));
  }

  public getRate(): number {
    return this.rate;
  }

  private getBestMoeVoice(preferJapaneseOnly: boolean = false): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    if (preferJapaneseOnly) {
      const jpVoices = [
        'Google 日本語',
        'Microsoft Nanami',
        'Kyoko',
        'O-Ren',
        'Haruka',
        'Sayaka',
        'Ayumi',
      ];
      for (const name of jpVoices) {
        const match = voices.find((v) => v.name.includes(name));
        if (match) return match;
      }
      const anyJp = voices.find((v) => v.lang.startsWith('ja'));
      if (anyJp) return anyJp;
    }

    // For Chinese + Japanese Moe feel, prioritize sweet/young female voices
    const moePreferredNames = [
      'Microsoft HsiaoChen',
      'Xiaoxiao',
      'Mei-Jia',
      'Google 國語（臺灣）',
      'Google 日本語',
      'Kyoko',
      'Microsoft Nanami',
      'Hanhan',
      'Ting-Ting',
    ];

    for (const name of moePreferredNames) {
      const match = voices.find((v) => v.name.includes(name));
      if (match) return match;
    }

    const zhTw = voices.find((v) => v.lang === 'zh-TW' || v.lang === 'zh-HK');
    if (zhTw) return zhTw;

    const jaJp = voices.find((v) => v.lang.startsWith('ja'));
    if (jaJp) return jaJp;

    const anyZh = voices.find((v) => v.lang.startsWith('zh'));
    if (anyZh) return anyZh;

    return voices[0] || null;
  }

  /**
   * Plays WAV base64 through Web Audio API with Japanese Anime Moe Formant/Pitch Exciter
   */
  private async playCloudMoeAudio(base64Data: string): Promise<boolean> {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer.slice(0));
      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;

      // Shift pitch/speed up slightly (e.g. 1.15x - 1.22x) for authentic anime moe seiyuu timbre
      const moeShift = 1.0 + (this.pitch - 1.0) * 0.32;
      source.playbackRate.value = Math.max(1.05, Math.min(1.3, moeShift));

      // High-pass filter to remove deep chestiness
      const highpass = this.audioCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 210;

      // High-shelf air boost for sparkling anime voice clarity
      const highshelf = this.audioCtx.createBiquadFilter();
      highshelf.type = 'highshelf';
      highshelf.frequency.value = 3600;
      highshelf.gain.value = 5.5;

      const gainNode = this.audioCtx.createGain();
      gainNode.gain.value = this.volume;

      source.connect(highpass);
      highpass.connect(highshelf);
      highshelf.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      this.activeSource = source;
      if (this.speakingListener) this.speakingListener(true);

      source.onended = () => {
        this.activeSource = null;
        if (this.speakingListener) this.speakingListener(false);
      };

      source.start(0);
      return true;
    } catch (err) {
      console.warn('WebAudio cloud playback fallback:', err);
      return false;
    }
  }

  public async speak(text: string) {
    if (!this.isEnabled || typeof window === 'undefined') return;

    this.stop();

    // 濾水器：清空特殊符號
    const cleanText = text
      .replace(/[*#_`~\[\]\(\)>✦🐾]/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim();

    if (!cleanText) return;

    const token = this.speakToken; // stop() 已經遞增過
    const controller = new AbortController();
    this.ttsAbort = controller;

    try {
      if (this.speakingListener) this.speakingListener(true);
      console.log('[前端] 正在呼叫無月專屬聲帶...');

      // 1. 發送 POST 請求給 Node.js
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`後端拒絕連線，狀態碼: ${response.status}`);
      }

      // 2. 解析後端傳來的 JSON
      const data = await response.json();

      // 等待期間被打斷或有更新的語音 → 丟掉這段，避免兩段聲音疊在一起
      if (token !== this.speakToken) return;

      if (!data || !data.audioBase64) {
        throw new Error('後端回傳的資料缺少 audioBase64！');
      }

      // 3. 把 Base64 組裝成聲音網址並播放
      const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
      audio.volume = this.volume;
      this.currentAudio = audio;

      const finish = () => {
        if (this.currentAudio === audio) this.currentAudio = null;
        if (token === this.speakToken && this.speakingListener) this.speakingListener(false);
      };
      audio.onended = finish;
      audio.onerror = finish;

      await audio.play();
    } catch (error: any) {
      if (error?.name === 'AbortError' || token !== this.speakToken) return;
      console.error('[前端] 呼叫無月聲帶失敗:', error);
      if (this.speakingListener) this.speakingListener(false);
    } finally {
      if (this.ttsAbort === controller) this.ttsAbort = null;
    }
  }

  public stop() {
    this.speakToken++;
    if (this.ttsAbort) {
      this.ttsAbort.abort();
      this.ttsAbort = null;
    }
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
