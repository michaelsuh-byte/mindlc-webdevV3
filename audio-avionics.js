/**
 * Audio & Voice Controller with:
 *  - Studio Neural Human Voice (/api/tts)
 *  - Speaker Echo Lock (auto-mutes mic during tutor speech & Manim video narration)
 *  - Smart Speech Pause Detector Device (prevents long student explanations from being cut off mid-thought)
 */

import { VOCAL_PROFILES, NEURAL_HUMAN_VOICES } from './svs-engine.js';

/**
 * Detects if the student's current spoken transcript ends mid-clause / mid-equation
 * so the Speech Pause Detector automatically grants extra pause time (+1400ms).
 */
export function isIncompleteSpokenClause(text = '') {
  const clean = String(text || '').trim().toLowerCase();
  if (!clean) return false;
  return /\b(and|or|but|because|since|so|therefore|if|when|then|where|which|that|plus|minus|times|multiplied\s+by|divided\s+by|over|equals|is\s+equal\s+to|to\s+the\s+power\s+of|square\s+root\s+of|um|uh|er|like|first|second|next)\s*$/i.test(
    clean
  );
}

export class AudioAvionicsController {
  constructor(callbacks = {}) {
    this.onVadStateChange = callbacks.onVadStateChange || (() => {});
    this.onPauseDetectorUpdate = callbacks.onPauseDetectorUpdate || (() => {});
    this.onBargeIn = callbacks.onBargeIn || (() => {});
    this.onSpeechRecognized = callbacks.onSpeechRecognized || (() => {});
    this.onInterimTranscript = callbacks.onInterimTranscript || (() => {});
    this.onBotSpeakingChange = callbacks.onBotSpeakingChange || (() => {});
    this.onTtfaMeasured = callbacks.onTtfaMeasured || (() => {});
    this.onVoicesUpdated = callbacks.onVoicesUpdated || (() => {});

    this.audioCtx = null;
    this.analyser = null;
    this.micStream = null;

    this.currentAudioEl = null;
    this.currentAudioUrl = null;
    this.ttsAbortController = null;

    // Smart Speech Pause Detector parameters
    // Default 2400ms (2.4s) pause tolerance so natural breathing/thinking pauses never cut off long explanations
    this.vadSilenceThresholdMs = 2400;
    this.vadEnergyThreshold = 0.026;
    this.manualSendHoldMode = false; // When true, never auto-submits until user clicks Send

    // Speaker Echo Protection parameters
    this.echoProtectionEnabled = true;
    this.echoCooldownUntil = 0;
    this.echoTailMs = 550;

    this.isMicActive = false;
    this.isUserSpeaking = false;
    this.isBotSpeaking = false;
    this.lastVoiceActivityTime = 0;
    this.lastSpeechEventTimestamp = 0;
    this.resumeMicTimer = null;

    // Adjustable voice parameters (default speaking speed set to 1.1x)
    this.customRateMultiplier = 1.1;
    this.customPitchMultiplier = 1.0;
    this.selectedVoiceURI = '';

    // Web Speech API STT buffer
    this.recognition = null;
    this.recognitionPausedForPlayback = false;
    this.finalizedTranscript = '';
    this.currentInterimTranscript = '';

    this.apiKey = '';
    this.activeProfile = 'CHARLIE';
    this.activeMode = 1;
    this.maxWords = 30;
  }

  getNeuralVoicesList() {
    return NEURAL_HUMAN_VOICES;
  }

  getSelectedNeuralVoiceName(profileKey = 'CHARLIE') {
    if (this.selectedVoiceURI) {
      return this.selectedVoiceURI;
    }
    const profile = VOCAL_PROFILES[profileKey] || VOCAL_PROFILES.CHARLIE;
    return profile.geminiVoice || 'Aoede';
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({ sampleRate: 24000 });
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  isIncompleteSpokenClause(text = '') {
    return isIncompleteSpokenClause(text);
  }

  getCombinedPendingTranscript() {
    return `${this.finalizedTranscript} ${this.currentInterimTranscript}`.replace(/\s+/g, ' ').trim();
  }

  hasBufferedSpeech() {
    return this.getCombinedPendingTranscript().length > 0;
  }

  setManualHoldMode(enabled) {
    this.manualSendHoldMode = Boolean(enabled);
    const hasSpeech = this.hasBufferedSpeech();
    this.onPauseDetectorUpdate({
      active: hasSpeech,
      holdMode: this.manualSendHoldMode,
      progress: hasSpeech ? 1 : 0,
      status: this.isUserSpeaking ? 'SPEAKING' : 'PAUSE_COUNTDOWN',
      extendedForClause: false,
      elapsedMs: 0,
      targetMs: this.vadSilenceThresholdMs
    });
  }

  setBotSpeakingState(speaking) {
    this.isBotSpeaking = Boolean(speaking);
    if (this.isBotSpeaking) {
      this.engageSpeakerEchoLock();
    } else {
      this.releaseSpeakerEchoLock();
    }
    this.onBotSpeakingChange(this.isBotSpeaking);
  }

  clearPendingTranscript() {
    this.finalizedTranscript = '';
    this.currentInterimTranscript = '';
    this.onPauseDetectorUpdate({
      active: false,
      holdMode: this.manualSendHoldMode,
      progress: 0,
      status: 'IDLE',
      extendedForClause: false,
      elapsedMs: 0,
      targetMs: this.vadSilenceThresholdMs
    });
  }

  /**
   * Immediately flushes and dispatches any accumulated spoken transcript
   */
  flushPendingSpeechNow() {
    const fullText = this.getCombinedPendingTranscript();
    this.clearPendingTranscript();
    if (fullText) {
      this.onSpeechRecognized(fullText);
    }
  }

  /**
   * Mutes microphone input & pauses speech recognition while the tutor or Manim video is speaking
   */
  engageSpeakerEchoLock() {
    clearTimeout(this.resumeMicTimer);
    this.clearPendingTranscript();
    this.isUserSpeaking = false;

    if (!this.echoProtectionEnabled) return;

    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }

    if (this.recognition && this.isMicActive) {
      this.recognitionPausedForPlayback = true;
      try {
        this.recognition.abort();
      } catch (_) {}
    }
  }

  /**
   * Releases the speaker echo lock after a brief room-reverb tail (550ms)
   */
  releaseSpeakerEchoLock() {
    clearTimeout(this.resumeMicTimer);
    this.clearPendingTranscript();
    this.echoCooldownUntil = performance.now() + this.echoTailMs;

    this.resumeMicTimer = setTimeout(() => {
      if (this.isBotSpeaking) return;

      if (this.micStream && this.isMicActive) {
        this.micStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
      }

      if (this.isMicActive && this.recognitionPausedForPlayback && this.recognition) {
        this.recognitionPausedForPlayback = false;
        try {
          this.recognition.start();
        } catch (_) {}
      }

      this.onVadStateChange({
        isSpeaking: false,
        rms: 0,
        silenceMs: 0,
        isMutedForEcho: false
      });
    }, this.echoTailMs);
  }

  stopSpeaking(reason = 'USER_STOP') {
    if (this.ttsAbortController) {
      try {
        this.ttsAbortController.abort();
      } catch (_) {}
      this.ttsAbortController = null;
    }

    if (this.currentAudioEl) {
      try {
        this.currentAudioEl.pause();
        this.currentAudioEl.src = '';
      } catch (_) {}
      this.currentAudioEl = null;
    }

    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    if (this.isBotSpeaking) {
      this.isBotSpeaking = false;
      this.onBotSpeakingChange(false);
      this.releaseSpeakerEchoLock();
      this.onBargeIn(reason);
    }
  }

  triggerBargeIn(reason = 'USER_STOP') {
    this.stopSpeaking(reason);
  }

  async startMicrophone() {
    if (this.isMicActive) return true;

    try {
      const ctx = this.ensureAudioContext();
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const source = ctx.createMediaStreamSource(this.micStream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.7;
      source.connect(this.analyser);

      this.isMicActive = true;
      this.clearPendingTranscript();
      this.startWebSpeechRecognition();

      if (this.isBotSpeaking && this.echoProtectionEnabled) {
        this.engageSpeakerEchoLock();
      }

      this.runVadLoop();
      return true;
    } catch (err) {
      console.error('Microphone access failed:', err);
      return false;
    }
  }

  stopMicrophone() {
    this.isMicActive = false;
    this.isUserSpeaking = false;
    this.recognitionPausedForPlayback = false;
    clearTimeout(this.resumeMicTimer);
    this.clearPendingTranscript();

    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.abort();
      } catch (_) {}
      this.recognition = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    this.onVadStateChange({ isSpeaking: false, rms: 0, silenceMs: 0, isMutedForEcho: false });
  }

  startWebSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-CA';

    this.recognition.onresult = (event) => {
      if (this.echoProtectionEnabled && (this.isBotSpeaking || performance.now() < this.echoCooldownUntil)) {
        this.clearPendingTranscript();
        return;
      }

      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalChunk += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      this.lastSpeechEventTimestamp = performance.now();

      if (finalChunk.trim().length > 0) {
        this.finalizedTranscript = `${this.finalizedTranscript} ${finalChunk.trim()}`.replace(/\s+/g, ' ').trim();
      }
      this.currentInterimTranscript = interim.trim();

      const combined = this.getCombinedPendingTranscript();
      if (combined) {
        this.onInterimTranscript(combined);
      }
    };

    this.recognition.onerror = () => {};
    this.recognition.onend = () => {
      if (this.isMicActive && !this.recognitionPausedForPlayback && !this.isBotSpeaking && this.recognition) {
        try {
          this.recognition.start();
        } catch (_) {}
      }
    };

    if (!this.isBotSpeaking) {
      try {
        this.recognition.start();
      } catch (_) {}
    } else {
      this.recognitionPausedForPlayback = true;
    }
  }

  /**
   * 60fps VAD + Smart Speech Pause Detector Loop
   *Monitors both acoustic voice energy AND recognition transcript buffer so long multi-sentence
   * explanations are never cut off during breathing or mid-sentence pauses.
   */
  runVadLoop() {
    if (!this.isMicActive || !this.analyser) return;

    const now = performance.now();
    const isMutedForEcho = this.echoProtectionEnabled && (this.isBotSpeaking || now < this.echoCooldownUntil);

    if (isMutedForEcho) {
      this.isUserSpeaking = false;
      this.onVadStateChange({
        isSpeaking: false,
        rms: 0,
        silenceMs: 0,
        isMutedForEcho: true
      });
      requestAnimationFrame(() => this.runVadLoop());
      return;
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);

    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);

    if (rms > this.vadEnergyThreshold) {
      this.lastVoiceActivityTime = now;
      this.lastSpeechEventTimestamp = now;
      if (!this.isUserSpeaking) {
        this.isUserSpeaking = true;
      }
    }

    const silenceElapsed = this.lastVoiceActivityTime > 0 ? Math.max(0, now - this.lastVoiceActivityTime) : 0;
    if (this.isUserSpeaking && silenceElapsed >= 350) {
      this.isUserSpeaking = false;
    }

    // Smart Speech Pause Detector evaluation
    const combinedTranscript = this.getCombinedPendingTranscript();
    if (combinedTranscript.length > 0) {
      const pauseSinceSpeechMs = Math.max(0, now - this.lastSpeechEventTimestamp);
      const incomplete = this.isIncompleteSpokenClause(combinedTranscript);
      // Add +1400ms grace period if the student paused on a connector word ("and", "because", "plus", etc.) or still has interim words
      const extraGraceMs = incomplete || this.currentInterimTranscript.length > 0 ? 1400 : 0;
      const targetWaitMs = this.vadSilenceThresholdMs + extraGraceMs;

      this.onPauseDetectorUpdate({
        active: true,
        holdMode: this.manualSendHoldMode,
        progress: Math.min(1, pauseSinceSpeechMs / targetWaitMs),
        status: this.isUserSpeaking ? 'SPEAKING' : 'PAUSE_COUNTDOWN',
        extendedForClause: incomplete,
        elapsedMs: Math.round(pauseSinceSpeechMs),
        targetMs: Math.round(targetWaitMs)
      });

      if (!this.manualSendHoldMode && pauseSinceSpeechMs >= targetWaitMs && !this.isUserSpeaking) {
        this.flushPendingSpeechNow();
      }
    } else {
      this.onPauseDetectorUpdate({
        active: false,
        holdMode: this.manualSendHoldMode,
        progress: 0,
        status: 'IDLE',
        extendedForClause: false,
        elapsedMs: 0,
        targetMs: this.vadSilenceThresholdMs
      });
    }

    this.onVadStateChange({
      isSpeaking: this.isUserSpeaking,
      rms,
      silenceMs: Math.round(silenceElapsed),
      isMutedForEcho: false,
      waveform: dataArray
    });

    requestAnimationFrame(() => this.runVadLoop());
  }

  async fetchTtsBlobUrl(textChunk, voiceName, signal) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textChunk,
            voiceName: voiceName || 'Aoede',
            apiKey: this.apiKey || undefined
          }),
          signal
        });
        if (!res.ok) {
          throw new Error(`TTS HTTP ${res.status}`);
        }
        const wavBlob = await res.blob();
        return URL.createObjectURL(wavBlob);
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        lastErr = err;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 300 * attempt));
        }
      }
    }
    throw lastErr || new Error('Neural TTS unavailable');
  }

  /**
   * Speaks the tutor burst using ONLY Studio Neural Human Voice (e.g. Aoede).
   * NEVER falls back to generic browser/OS robotic speechSynthesis voice!
   */
  async speakCalibratedBurst(cleanText, profileKey = 'CHARLIE') {
    const startTs = performance.now();
    this.stopSpeaking('NEW_BURST');

    const normalizedText = String(cleanText || '').replace(/\$/g, '').replace(/\s+/g, ' ').trim();
    if (!normalizedText) return;

    this.isBotSpeaking = true;
    this.engageSpeakerEchoLock();
    this.onBotSpeakingChange(true);

    const voiceName = this.getSelectedNeuralVoiceName(profileKey);
    const abortCtrl = new AbortController();
    this.ttsAbortController = abortCtrl;

    try {
      const audioUrl = await this.fetchTtsBlobUrl(normalizedText, voiceName, abortCtrl.signal);
      if (abortCtrl.signal.aborted) {
        URL.revokeObjectURL(audioUrl);
        return;
      }

      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
      }
      this.currentAudioUrl = audioUrl;

      await new Promise((resolve, reject) => {
        const audio = new Audio(audioUrl);
        audio.playbackRate = Math.max(0.75, Math.min(1.5, this.customRateMultiplier || 1.1));
        this.currentAudioEl = audio;

        audio.onplay = () => {
          this.onTtfaMeasured(Math.round(performance.now() - startTs));
          this.isBotSpeaking = true;
          this.engageSpeakerEchoLock();
          this.onBotSpeakingChange(true);
        };

        audio.onended = () => resolve();
        audio.onerror = (e) => reject(e);

        audio.play().catch(reject);
      });

      if (!abortCtrl.signal.aborted) {
        this.isBotSpeaking = false;
        this.onBotSpeakingChange(false);
        this.releaseSpeakerEchoLock();
      }
    } catch (err) {
      if (err?.name === 'AbortError' || abortCtrl.signal.aborted) return;
      console.warn('Studio Neural TTS error (generic browser voice fallback is strictly disabled):', err);
      this.isBotSpeaking = false;
      this.onBotSpeakingChange(false);
      this.releaseSpeakerEchoLock();
    }
  }
}
