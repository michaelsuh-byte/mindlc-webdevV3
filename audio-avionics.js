/**
 * Audio & Voice Controller with Studio Neural Human Voice (/api/tts) & Speaker Echo Lock
 */

import { VOCAL_PROFILES, NEURAL_HUMAN_VOICES, buildSystemInstruction } from './svs-engine.js';

export class AudioAvionicsController {
  constructor(callbacks = {}) {
    this.onVadStateChange = callbacks.onVadStateChange || (() => {});
    this.onBargeIn = callbacks.onBargeIn || (() => {});
    this.onSpeechRecognized = callbacks.onSpeechRecognized || (() => {});
    this.onInterimTranscript = callbacks.onInterimTranscript || (() => {});
    this.onBotSpeakingChange = callbacks.onBotSpeakingChange || (() => {});
    this.onTtfaMeasured = callbacks.onTtfaMeasured || (() => {});
    this.onLiveSocketStatus = callbacks.onLiveSocketStatus || (() => {});
    this.onLiveAudioTranscript = callbacks.onLiveAudioTranscript || (() => {});
    this.onVoicesUpdated = callbacks.onVoicesUpdated || (() => {});

    this.audioCtx = null;
    this.analyser = null;
    this.micStream = null;
    this.processorNode = null;

    // Active HTML5 Audio element for Neural Human TTS playback
    this.currentAudioEl = null;
    this.currentAudioUrl = null;
    this.ttsAbortController = null;

    // VAD & Speaker Echo Protection parameters
    this.vadSilenceThresholdMs = 450;
    this.vadEnergyThreshold = 0.028;
    this.echoProtectionEnabled = true;
    this.echoCooldownUntil = 0;
    this.echoTailMs = 550;

    this.isMicActive = false;
    this.isUserSpeaking = false;
    this.isBotSpeaking = false;
    this.lastVoiceActivityTime = 0;
    this.silenceTimer = null;
    this.resumeMicTimer = null;

    // Adjustable voice parameters
    this.customRateMultiplier = 1.0;
    this.customPitchMultiplier = 1.0;
    this.selectedVoiceURI = ''; // '' = auto-select neural voice from Tutor Persona, or explicit neural voice name

    // Web Speech API STT
    this.recognition = null;
    this.recognitionPausedForPlayback = false;
    this.pendingTranscript = '';

    // Optional Gemini Live WebSocket
    this.ws = null;
    this.apiKey = '';
    this.engineMode = 'GEMINI_SERVER';
    this.activeProfile = 'CHARLIE';
    this.activeMode = 1;
    this.maxWords = 45;

    this.nextPlayTime = 0;
    this.activeAudioSources = [];
    this.turnDispatchTimestamp = 0;
    this.firstAudioReceivedForTurn = false;
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

  /**
   * Mutes microphone input & pauses speech recognition while the tutor is speaking
   * so the microphone NEVER picks up speaker sound or interrupts itself.
   */
  engageSpeakerEchoLock() {
    clearTimeout(this.silenceTimer);
    clearTimeout(this.resumeMicTimer);
    this.pendingTranscript = '';
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
   * Releases the speaker echo lock after a brief room-reverb tail (550ms) once tutor finishes speaking
   */
  releaseSpeakerEchoLock() {
    clearTimeout(this.resumeMicTimer);
    this.pendingTranscript = '';
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

  /**
   * Stops any ongoing Neural TTS or browser speech immediately
   */
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

    if (this.activeAudioSources.length > 0) {
      for (const src of this.activeAudioSources) {
        try {
          src.stop();
        } catch (_) {}
      }
      this.activeAudioSources = [];
      this.nextPlayTime = 0;
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
    clearTimeout(this.silenceTimer);
    clearTimeout(this.resumeMicTimer);

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
        this.pendingTranscript = '';
        return;
      }

      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalChunk += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim.trim().length > 0) {
        this.onInterimTranscript(interim.trim());
      }

      if (finalChunk.trim().length > 0) {
        this.pendingTranscript = (this.pendingTranscript + ' ' + finalChunk).trim();
        this.onInterimTranscript(this.pendingTranscript);

        clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => {
          if (this.pendingTranscript && !this.isBotSpeaking) {
            const textToDispatch = this.pendingTranscript;
            this.pendingTranscript = '';
            this.onSpeechRecognized(textToDispatch);
          }
        }, this.vadSilenceThresholdMs);
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
      if (!this.isUserSpeaking) {
        this.isUserSpeaking = true;
      }
    }

    const silenceElapsed = this.lastVoiceActivityTime > 0 ? Math.max(0, now - this.lastVoiceActivityTime) : 0;
    if (this.isUserSpeaking && silenceElapsed >= this.vadSilenceThresholdMs) {
      this.isUserSpeaking = false;
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

  /**
   * Speaks response using Studio-Grade Gemini Neural Human Voice (/api/tts),
   * while locking the microphone so it never hears the speaker output.
   */
  async speakCalibratedBurst(cleanText, profileKey = 'CHARLIE') {
    const startTs = performance.now();
    this.stopSpeaking('NEW_BURST');

    // Lock microphone BEFORE audio synthesis/playback begins
    this.isBotSpeaking = true;
    this.engageSpeakerEchoLock();
    this.onBotSpeakingChange(true);

    const voiceName = this.getSelectedNeuralVoiceName(profileKey);
    const abortCtrl = new AbortController();
    this.ttsAbortController = abortCtrl;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          voiceName,
          apiKey: this.apiKey || undefined
        }),
        signal: abortCtrl.signal
      });

      if (!res.ok) {
        throw new Error(`TTS HTTP ${res.status}`);
      }

      const wavBlob = await res.blob();
      if (abortCtrl.signal.aborted) return;

      const audioUrl = URL.createObjectURL(wavBlob);
      this.currentAudioUrl = audioUrl;

      const audio = new Audio(audioUrl);
      audio.playbackRate = Math.max(0.8, Math.min(1.25, this.customRateMultiplier));
      this.currentAudioEl = audio;

      audio.onplay = () => {
        this.onTtfaMeasured(Math.round(performance.now() - startTs));
        this.isBotSpeaking = true;
        this.engageSpeakerEchoLock();
        this.onBotSpeakingChange(true);
      };

      audio.onended = () => {
        this.isBotSpeaking = false;
        this.onBotSpeakingChange(false);
        this.releaseSpeakerEchoLock();
      };

      audio.onerror = () => {
        this.isBotSpeaking = false;
        this.onBotSpeakingChange(false);
        this.releaseSpeakerEchoLock();
      };

      await audio.play();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('Neural TTS fallback to browser speech:', err);
      this.speakBrowserFallback(cleanText, profileKey);
    }
  }

  speakBrowserFallback(cleanText, profileKey = 'CHARLIE') {
    if (!('speechSynthesis' in window)) {
      this.isBotSpeaking = false;
      this.onBotSpeakingChange(false);
      this.releaseSpeakerEchoLock();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = Math.max(0.85, Math.min(1.2, this.customRateMultiplier));
    utterance.pitch = Math.max(0.9, Math.min(1.1, this.customPitchMultiplier));
    utterance.lang = 'en-CA';

    utterance.onend = () => {
      this.isBotSpeaking = false;
      this.onBotSpeakingChange(false);
      this.releaseSpeakerEchoLock();
    };

    utterance.onerror = () => {
      this.isBotSpeaking = false;
      this.onBotSpeakingChange(false);
      this.releaseSpeakerEchoLock();
    };

    window.speechSynthesis.speak(utterance);
  }
}
