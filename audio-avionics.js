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
    this.vadEnergyThreshold = 0.045;
    this.manualSendHoldMode = false; // When true, never auto-submits until user clicks Send

    // Speaker Echo Protection parameters
    this.echoProtectionEnabled = true;
    this.echoCooldownUntil = 0;
    this.echoTailMs = 800;
    this.botSpeechEndedTimestamp = 0;

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

    // Web Speech API STT state (hard-aborted during tutor speech, freshly instantiated on resume)
    this.recognition = null;
    this.recognitionPausedForPlayback = false;
    this.isRecognitionRunning = false;
    this.recognitionRestartTimer = null;
    this.lastWatchdogTimestamp = 0;
    this.lastTutorSpokenNormalized = '';
    this.lastTutorSpokenWords = new Set();
    this.lastTutorTailNormalized = '';
    this.lastTutorTailWordsList = [];
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
   * Records the tutor's spoken text AND specifically the tail (last 8 words) of the sentence
   * so any late speaker bleed of the final word or phrase is stripped or rejected immediately.
   */
  recordTutorSpokenFingerprint(text = '') {
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was',
      'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now',
      'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she',
      'too', 'use', 'what', 'when', 'where', 'which', 'while', 'with', 'this', 'that', 'from', 'have'
    ]);
    const norm = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    this.lastTutorSpokenNormalized = norm;
    const allWords = norm.split(' ').filter(Boolean);
    this.lastTutorSpokenWords = new Set(allWords.filter(w => w.length >= 4 && !stopWords.has(w)));
    this.lastTutorTailWordsList = allWords.slice(-8);
    this.lastTutorTailNormalized = this.lastTutorTailWordsList.join(' ');
  }

  /**
   * Strips any leading words (or the entire phrase) if they match the last word/phrase of the tutor's speech.
   */
  stripTutorTailEcho(candidateText = '') {
    const raw = String(candidateText || '').trim();
    if (!this.echoProtectionEnabled || !this.lastTutorSpokenNormalized || !raw) {
      return raw;
    }

    const rawWords = raw.split(/\s+/).filter(Boolean);
    const normWords = rawWords.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (normWords.length === 0) return '';

    const fullNorm = normWords.join(' ');

    // 1. Exact tail suffix match (even 1, 2, or 3 words at the end of the tutor's sentence!)
    if (
      this.lastTutorSpokenNormalized.endsWith(fullNorm) ||
      (this.lastTutorTailNormalized && this.lastTutorTailNormalized.includes(fullNorm))
    ) {
      return '';
    }

    // 2. Any 3+ word phrase contained verbatim anywhere in the tutor's last burst
    if (normWords.length >= 3 && this.lastTutorSpokenNormalized.includes(fullNorm)) {
      return '';
    }

    // 3. If the recognized string starts with 1–6 words from the tail of the tutor's sentence followed by user speech,
    // strip the leading tail echo words first and keep the user's words!
    let remainingRawWords = rawWords;
    if (this.lastTutorTailWordsList.length > 0 && rawWords.length > 1) {
      for (let prefixLen = Math.min(6, rawWords.length - 1); prefixLen >= 1; prefixLen--) {
        const prefixNorm = rawWords
          .slice(0, prefixLen)
          .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
          .filter(Boolean)
          .join(' ');
        if (
          prefixNorm &&
          (this.lastTutorSpokenNormalized.endsWith(prefixNorm) ||
            (prefixLen >= 2 && this.lastTutorTailNormalized.includes(prefixNorm)))
        ) {
          remainingRawWords = rawWords.slice(prefixLen);
          break;
        }
      }
    }

    // 4. High content-word overlap check on the remaining words
    const remNormWords = remainingRawWords
      .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
    const sigWords = remNormWords.filter(w => w.length >= 4);
    if (sigWords.length >= 4 && this.lastTutorSpokenWords.size > 0) {
      let matches = 0;
      for (const w of sigWords) {
        if (this.lastTutorSpokenWords.has(w)) matches++;
      }
      if (matches / sigWords.length >= 0.75) {
        return '';
      }
    }

    return remainingRawWords.join(' ').trim();
  }

  /**
   * Secondary acoustic echo guard: checks if a recognized phrase is actually the tutor's own explanation
   * (including its final word or short phrase) bleeding from the speakers.
   */
  isLikelyTutorEcho(candidateText = '') {
    if (!this.echoProtectionEnabled || !this.lastTutorSpokenNormalized) return false;
    const stripped = this.stripTutorTailEcho(candidateText);
    return stripped.length === 0;
  }

  /**
   * Completely detaches and aborts the active SpeechRecognition instance so zero OS microphone
   * audio can be transcribed while the tutor is speaking.
   */
  destroyRecognitionInstance() {
    clearTimeout(this.recognitionRestartTimer);
    this.isRecognitionRunning = false;
    if (this.recognition) {
      const rec = this.recognition;
      this.recognition = null;
      try {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch (_) {}
    }
  }

  /**
   * Mutes microphone hardware track & completely aborts Web Speech Recognition while the tutor
   * or solution video is speaking so the tutor's voice is NEVER picked up by the microphone.
   */
  engageSpeakerEchoLock() {
    clearTimeout(this.resumeMicTimer);
    clearTimeout(this.recognitionRestartTimer);
    this.clearPendingTranscript();
    this.onInterimTranscript('');
    this.isUserSpeaking = false;

    if (!this.echoProtectionEnabled) return;

    this.recognitionPausedForPlayback = true;

    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }

    this.destroyRecognitionInstance();

    this.onVadStateChange({
      isSpeaking: false,
      rms: 0,
      silenceMs: 0,
      isMutedForEcho: true
    });
  }

  /**
   * Releases the speaker echo lock after a brief 260ms room-reverb tail and creates a fresh
   * SpeechRecognition instance so it starts cleanly without Chrome's aborted-instance state bug.
   */
  releaseSpeakerEchoLock() {
    clearTimeout(this.resumeMicTimer);
    this.clearPendingTranscript();
    this.echoCooldownUntil = performance.now() + this.echoTailMs;

    this.resumeMicTimer = setTimeout(() => {
      if (this.isBotSpeaking) return;

      this.recognitionPausedForPlayback = false;
      this.clearPendingTranscript();

      if (this.micStream && this.isMicActive) {
        this.micStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
      }

      if (this.isMicActive) {
        this.startWebSpeechRecognition();
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

    if (this.isBotSpeaking && reason !== 'NEW_BURST') {
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

      if (this.isBotSpeaking && this.echoProtectionEnabled) {
        this.engageSpeakerEchoLock();
      } else {
        this.recognitionPausedForPlayback = false;
        this.startWebSpeechRecognition();
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
    this.destroyRecognitionInstance();
    this.clearPendingTranscript();

    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    this.onVadStateChange({ isSpeaking: false, rms: 0, silenceMs: 0, isMutedForEcho: false });
  }

  startWebSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !this.isMicActive) return;

    if (this.echoProtectionEnabled && (this.isBotSpeaking || this.recognitionPausedForPlayback)) {
      return;
    }

    this.destroyRecognitionInstance();

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-CA';
    this.recognition = rec;

    rec.onstart = () => {
      if (this.recognition !== rec) return;
      this.isRecognitionRunning = true;
    };

    rec.onresult = (event) => {
      if (this.recognition !== rec) return;
      const now = performance.now();
      if (
        this.echoProtectionEnabled &&
        (this.isBotSpeaking || this.recognitionPausedForPlayback || now < this.echoCooldownUntil)
      ) {
        this.clearPendingTranscript();
        return;
      }

      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const rawTranscript = String(event.results[i][0]?.transcript || '').trim();
        const transcript = this.stripTutorTailEcho(rawTranscript);
        if (!transcript) continue;

        if (event.results[i].isFinal) {
          finalChunk += transcript + ' ';
        } else {
          interim += transcript + ' ';
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

      const combined = this.stripTutorTailEcho(this.getCombinedPendingTranscript());
      if (combined) {
        this.onInterimTranscript(combined);
      } else {
        this.clearPendingTranscript();
        this.onInterimTranscript('');
      }
    };

    rec.onerror = (event) => {
      if (this.recognition !== rec) return;
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        this.isRecognitionRunning = false;
      }
    };

    rec.onend = () => {
      if (this.recognition !== rec) return;
      this.isRecognitionRunning = false;
      if (this.isMicActive && !this.recognitionPausedForPlayback && !this.isBotSpeaking) {
        this.recognitionRestartTimer = setTimeout(() => {
          if (this.isMicActive && !this.recognitionPausedForPlayback && !this.isBotSpeaking) {
            this.startWebSpeechRecognition();
          }
        }, 80);
      }
    };

    try {
      rec.start();
    } catch (_) {}
  }

  /**
   * 60fps VAD + Smart Speech Pause Detector Loop
   * Monitors both acoustic voice energy AND recognition transcript buffer so long multi-sentence
   * explanations are never cut off during breathing or mid-sentence pauses.
   */
  runVadLoop() {
    if (!this.isMicActive || !this.analyser) return;

    const now = performance.now();
    const isMutedForEcho =
      this.echoProtectionEnabled &&
      (this.isBotSpeaking || this.recognitionPausedForPlayback || now < this.echoCooldownUntil);

    if (isMutedForEcho) {
      this.isUserSpeaking = false;
      if (this.recognition) {
        this.destroyRecognitionInstance();
      }
      this.onVadStateChange({
        isSpeaking: false,
        rms: 0,
        silenceMs: 0,
        isMutedForEcho: true
      });
      requestAnimationFrame(() => this.runVadLoop());
      return;
    }

    // Watchdog: when NOT muted for echo, ensure a fresh SpeechRecognition instance is actively running
    if (!this.isRecognitionRunning && now - this.lastWatchdogTimestamp > 450) {
      this.lastWatchdogTimestamp = now;
      this.startWebSpeechRecognition();
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
      if (!this.isUserSpeaking) {
        this.isUserSpeaking = true;
      }
    }

    const silenceElapsed = this.lastVoiceActivityTime > 0 ? Math.max(0, now - this.lastVoiceActivityTime) : 0;
    if (this.isUserSpeaking && silenceElapsed >= 320) {
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

      if (!this.manualSendHoldMode && pauseSinceSpeechMs >= targetWaitMs) {
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

    this.recordTutorSpokenFingerprint(chunks.join(' '));
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
