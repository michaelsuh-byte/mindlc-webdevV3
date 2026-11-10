/**
 * Audio & Voice Controller with:
 *  - Studio Neural Human Voice (/api/tts)
 *  - Speaker Echo Lock (auto-mutes mic during tutor speech & Manim video narration)
 *  - Smart Speech Pause Detector Device (prevents long student explanations from being cut off mid-thought)
 */

import { VOCAL_PROFILES, NEURAL_HUMAN_VOICES, splitSpokenTextIntoClauses } from './svs-engine.js';

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
    this.echoTailMs = 180;

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

    // Web Speech API STT buffer (kept warm across turns for 0ms resume)
    this.recognition = null;
    this.isRecognitionRunning = false;
    this.recognitionRestartTimer = null;
    this.lastWatchdogTimestamp = 0;
    this.echoTaintedPrefixByIndex = new Map();
    this.finalizedTranscript = '';
    this.currentInterimTranscript = '';
    this.vadDataArray = null;

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
   * Ensures Web Speech Recognition is running without throwing InvalidStateError
   * or suffering cold-start drops when transitioning between speaker output and user voice.
   */
  safeStartRecognition() {
    if (!this.recognition || !this.isMicActive || this.isRecognitionRunning) return;
    clearTimeout(this.recognitionRestartTimer);
    try {
      this.recognition.start();
    } catch (_) {
      this.recognitionRestartTimer = setTimeout(() => {
        if (this.isMicActive && !this.isRecognitionRunning && this.recognition) {
          try {
            this.recognition.start();
          } catch (_) {}
        }
      }, 120);
    }
  }

  /**
   * Mutes microphone hardware track & gates speech recognition while the tutor or solution video is speaking.
   * Crucially keeps `SpeechRecognition` warm and connected (no `.abort()` cold-start delay) so user voice is
   * picked up on the very first word as soon as the tutor finishes speaking.
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

    this.onVadStateChange({
      isSpeaking: false,
      rms: 0,
      silenceMs: 0,
      isMutedForEcho: true
    });
  }

  /**
   * Releases the speaker echo lock immediately on the hardware mic track and clears echo gate after 180ms
   * so the user's first word is never dropped when they start speaking.
   */
  releaseSpeakerEchoLock() {
    clearTimeout(this.resumeMicTimer);
    this.clearPendingTranscript();
    this.echoCooldownUntil = performance.now() + this.echoTailMs;

    // Re-enable hardware audio track immediately so browser audio capture has 0ms warm-up
    if (this.micStream && this.isMicActive) {
      this.micStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
    }

    if (this.isMicActive) {
      this.safeStartRecognition();
    }

    this.resumeMicTimer = setTimeout(() => {
      if (this.isBotSpeaking) return;

      if (this.micStream && this.isMicActive) {
        this.micStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
      }

      if (this.isMicActive) {
        this.safeStartRecognition();
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
      this.vadDataArray = new Uint8Array(this.analyser.frequencyBinCount);

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
    this.isRecognitionRunning = false;
    clearTimeout(this.resumeMicTimer);
    clearTimeout(this.recognitionRestartTimer);
    this.echoTaintedPrefixByIndex.clear();
    this.clearPendingTranscript();

    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.onresult = null;
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
    this.echoTaintedPrefixByIndex.clear();

    this.recognition.onstart = () => {
      this.isRecognitionRunning = true;
    };

    this.recognition.onresult = (event) => {
      const now = performance.now();
      const inEchoWindow =
        this.echoProtectionEnabled && (this.isBotSpeaking || now < this.echoCooldownUntil);

      if (inEchoWindow) {
        // Record any transcript prefix produced while speaker was active so speaker bleed is stripped
        // without aborting the recognition stream or dropping the student's first word afterward.
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const rawEcho = String(event.results[i][0]?.transcript || '');
          this.echoTaintedPrefixByIndex.set(i, rawEcho);
        }
        this.clearPendingTranscript();
        return;
      }

      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        let transcript = String(event.results[i][0]?.transcript || '');
        const taintedPrefix = this.echoTaintedPrefixByIndex.get(i);
        if (taintedPrefix) {
          if (transcript.toLowerCase().startsWith(taintedPrefix.toLowerCase())) {
            transcript = transcript.slice(taintedPrefix.length);
          } else if (event.results[i].isFinal && transcript.trim() === taintedPrefix.trim()) {
            transcript = '';
          }
          if (event.results[i].isFinal) {
            this.echoTaintedPrefixByIndex.delete(i);
          }
        }

        if (!transcript.trim()) continue;

        if (event.results[i].isFinal) {
          finalChunk += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      if (!finalChunk.trim() && !interim.trim()) {
        return;
      }

      this.lastSpeechEventTimestamp = now;

      if (finalChunk.trim().length > 0) {
        this.finalizedTranscript = `${this.finalizedTranscript} ${finalChunk.trim()}`.replace(/\s+/g, ' ').trim();
      }
      this.currentInterimTranscript = interim.trim();

      const combined = this.getCombinedPendingTranscript();
      if (combined) {
        this.onInterimTranscript(combined);
      }
    };

    this.recognition.onerror = (event) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        this.isRecognitionRunning = false;
      }
    };

    this.recognition.onend = () => {
      this.isRecognitionRunning = false;
      this.echoTaintedPrefixByIndex.clear();
      if (this.isMicActive && this.recognition) {
        this.safeStartRecognition();
      }
    };

    this.safeStartRecognition();
  }

  /**
   * 60fps VAD + Smart Speech Pause Detector Loop
   * Monitors both acoustic voice energy AND recognition transcript buffer so long multi-sentence
   * explanations are never cut off during breathing or mid-sentence pauses.
   */
  runVadLoop() {
    if (!this.isMicActive || !this.analyser) return;

    const now = performance.now();

    // Watchdog: ensure Web Speech Recognition stays warm and active whenever mic is on
    if (!this.isRecognitionRunning && now - this.lastWatchdogTimestamp > 450) {
      this.lastWatchdogTimestamp = now;
      this.safeStartRecognition();
    }

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

    const dataArray = this.vadDataArray || new Uint8Array(this.analyser.frequencyBinCount);
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

  base64ToBlobUrl(base64Str, mimeType = 'audio/wav') {
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  /**
   * Option 4 Zero-Delay Voice Emitter:
   * - Plays pre-bundled `firstChunkWavBase64` from `/api/chat` at 0.0s (instantaneous when transcript appears)
   *   while streaming `audioChunks[1]` in parallel from the server's pre-warm cache.
   * - Strictly uses Studio Neural Human Voice (e.g. Aoede); NEVER falls back to generic browser speechSynthesis.
   */
  async speakCalibratedBurst(cleanText, profileKey = 'CHARLIE', prewarmedAudio = null) {
    const startTs = performance.now();
    this.stopSpeaking('NEW_BURST');

    const chunks =
      Array.isArray(prewarmedAudio?.audioChunks) && prewarmedAudio.audioChunks.length > 0
        ? prewarmedAudio.audioChunks
        : splitSpokenTextIntoClauses(cleanText, this.maxWords);

    if (chunks.length === 0) return;

    this.isBotSpeaking = true;
    this.engageSpeakerEchoLock();
    this.onBotSpeakingChange(true);

    const voiceName = this.getSelectedNeuralVoiceName(profileKey);
    const abortCtrl = new AbortController();
    this.ttsAbortController = abortCtrl;

    try {
      // Prepare URL promises for all chunks in parallel:
      // Chunk 0 uses inline base64 audio from `/api/chat` when available (0ms network wait!)
      const urlPromises = chunks.map((chunkText, idx) => {
        if (idx === 0 && prewarmedAudio?.firstChunkWavBase64) {
          return Promise.resolve(this.base64ToBlobUrl(prewarmedAudio.firstChunkWavBase64));
        }
        return this.fetchTtsBlobUrl(chunkText, voiceName, abortCtrl.signal);
      });

      for (let i = 0; i < urlPromises.length; i++) {
        const audioUrl = await urlPromises[i];
        if (abortCtrl.signal.aborted) {
          URL.revokeObjectURL(audioUrl);
          return;
        }

        if (this.currentAudioUrl) {
          URL.revokeObjectURL(this.currentAudioUrl);
        }
        this.currentAudioUrl = audioUrl;

        await new Promise((resolve, reject) => {
          const activeRate = Math.max(0.75, Math.min(1.5, Number(this.customRateMultiplier) || 1.1));
          const audio = new Audio(audioUrl);
          audio.defaultPlaybackRate = activeRate;
          audio.playbackRate = activeRate;
          audio.preservesPitch = true;
          this.currentAudioEl = audio;

          audio.onplay = () => {
            const latestRate = Math.max(0.75, Math.min(1.5, Number(this.customRateMultiplier) || 1.1));
            audio.defaultPlaybackRate = latestRate;
            audio.playbackRate = latestRate;
            if (i === 0) {
              this.onTtfaMeasured(Math.round(performance.now() - startTs));
            }
            this.isBotSpeaking = true;
            this.engageSpeakerEchoLock();
            this.onBotSpeakingChange(true);
          };

          audio.onended = () => resolve();
          audio.onerror = (e) => reject(e);

          audio.play().catch(reject);
        });
      }

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
