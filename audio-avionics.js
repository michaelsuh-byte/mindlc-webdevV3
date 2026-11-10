/**
 * Audio & Voice Controller with:
 *  - Studio Neural Human Voice (/api/tts) with Multi-Model Failover
 *  - Voice Integrity & Auto-Recovery Watchdog Layer:
 *      1. Prevents & auto-fixes two or more voices reading simultaneously (`claimExclusiveVoiceChannel`, `auditAndFixSimultaneousVoices`)
 *      2. Hard-blocks generic browser `window.speechSynthesis` and locks Studio Neural Voice persona (`enforceLockedNeuralVoice`)
 *      3. Detects mid-session voice stalls, silent turns, or unread script clauses and auto-heals playback (`autoRecoverUnreadScript`)
 *  - Speaker Echo Lock (auto-mutes mic during tutor speech & solution video narration)
 *  - Smart Speech Pause Detector Device (prevents long student explanations from being cut off mid-thought)
 */

import { VOCAL_PROFILES, NEURAL_HUMAN_VOICES, splitSpokenTextIntoClauses } from './svs-engine.js';

const VALID_NEURAL_VOICE_IDS = new Set(NEURAL_HUMAN_VOICES.map(v => v.id));
let globalVoiceMutexToken = 0;
const globalActiveAudioEntries = [];

/**
 * Claims exclusive access to the voice output channel across the entire application
 * (both Chat Tutor bursts and Step-by-Step Solution Video scenes).
 * Immediately pauses, mutes, and detaches any other HTMLAudioElement so two voices can NEVER play simultaneously.
 */
export function claimExclusiveVoiceChannel(audioEl, sourceTag = 'CHAT_TUTOR') {
  const token = ++globalVoiceMutexToken;

  for (let i = globalActiveAudioEntries.length - 1; i >= 0; i--) {
    const entry = globalActiveAudioEntries[i];
    if (entry.audio && entry.audio !== audioEl) {
      try {
        entry.audio.onended = null;
        entry.audio.onerror = null;
        entry.audio.onplay = null;
        entry.audio.muted = true;
        entry.audio.volume = 0;
        entry.audio.pause();
        entry.audio.src = '';
      } catch (_) {}
      globalActiveAudioEntries.splice(i, 1);
    }
  }

  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }

  if (audioEl) {
    globalActiveAudioEntries.push({
      audio: audioEl,
      token,
      sourceTag,
      startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now()
    });
  }

  return token;
}

/**
 * Releases an HTMLAudioElement from the global active voice registry when it finishes or is stopped.
 */
export function releaseVoiceChannel(audioEl) {
  for (let i = globalActiveAudioEntries.length - 1; i >= 0; i--) {
    if (globalActiveAudioEntries[i].audio === audioEl) {
      globalActiveAudioEntries.splice(i, 1);
    }
  }
}

/**
 * Audits all active audio streams in real time.
 * If 2 or more voices are ever playing simultaneously, immediately kills all older streams
 * and leaves only the single newest stream playing.
 */
export function auditAndFixSimultaneousVoices() {
  const playingEntries = globalActiveAudioEntries.filter(
    e => e.audio && !e.audio.paused && !e.audio.ended && !e.audio.muted && e.audio.volume > 0
  );

  if (playingEntries.length <= 1) {
    return { collisionDetected: false, stoppedCount: 0 };
  }

  // Sort by token ascending so the last element is the newest valid voice owner
  playingEntries.sort((a, b) => a.token - b.token);
  const newest = playingEntries[playingEntries.length - 1];
  let stoppedCount = 0;

  for (let i = 0; i < playingEntries.length - 1; i++) {
    const dup = playingEntries[i].audio;
    try {
      dup.onended = null;
      dup.onerror = null;
      dup.onplay = null;
      dup.muted = true;
      dup.volume = 0;
      dup.pause();
      dup.src = '';
      stoppedCount++;
    } catch (_) {}
    releaseVoiceChannel(dup);
  }

  return {
    collisionDetected: true,
    stoppedCount,
    keptSource: newest.sourceTag
  };
}

/**
 * Hard-blocks the browser's generic robotic `window.speechSynthesis` engine so the voice model
 * can never switch to a generic AI voice.
 */
export function blockGenericBrowserSpeechSynthesis(onBlocked = null) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  let blockedAny = false;
  try {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      blockedAny = true;
    }
    if (!window.speechSynthesis.__svsHardBlocked) {
      const nativeCancel = window.speechSynthesis.cancel.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (utterance) => {
        try {
          nativeCancel();
        } catch (_) {}
        if (typeof onBlocked === 'function') {
          onBlocked(utterance?.text || '');
        }
      };
      window.speechSynthesis.__svsHardBlocked = true;
    }
  } catch (_) {}
  return blockedAny;
}

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
    this.onVoiceIntegrityEvent = callbacks.onVoiceIntegrityEvent || (() => {});

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
    this.echoTailMs = 1000;
    this.botSpeechEndedTimestamp = 0;
    this.lastBotSpeechEndTime = 0;

    this.isMicActive = false;
    this.isUserSpeaking = false;
    this.isBotSpeaking = false;
    this.lastVoiceActivityTime = 0;
    this.lastSpeechEventTimestamp = 0;
    this.resumeMicTimer = null;
    this.micSettleTimer = null;

    // Script Playback, Talking-Point Verification & Voice Integrity Auto-Recovery State
    this.speechGenerationId = 0;
    this.activeScriptClauses = [];
    this.activeClauseIndex = 0;
    this.unspokenRemainderText = '';
    this.lockedVoicePersona = 'Aoede';
    this.voiceWatchdogTimer = null;
    this.lastAudioProgressTs = 0;
    this.lastObservedAudioTime = -1;
    this.isAutoRecoveringVoice = false;
    this.voiceIntegrityStats = {
      simultaneousVoicesFixed: 0,
      genericVoiceBlocked: 0,
      stalledScriptsRecovered: 0,
      personaDriftFixed: 0
    };

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
    this.lastTutorTailWordSet = new Set();
    this.lastTutorTailStems = new Set();
    this.finalizedTranscript = '';
    this.currentInterimTranscript = '';
    this.vadDataArray = null;

    this.apiKey = '';
    this.activeProfile = 'CHARLIE';
    this.activeMode = 1;
    this.maxWords = 30;

    // Install generic browser voice blocker immediately
    blockGenericBrowserSpeechSynthesis((blockedText) => {
      this.voiceIntegrityStats.genericVoiceBlocked++;
      this.onVoiceIntegrityEvent({
        type: 'GENERIC_VOICE_BLOCKED',
        detail: 'Blocked generic browser speechSynthesis and enforced Studio Neural Voice',
        text: blockedText
      });
    });
  }

  getNeuralVoicesList() {
    return NEURAL_HUMAN_VOICES;
  }

  /**
   * Enforces and returns the locked Studio Neural Voice name (e.g. Aoede).
   * Automatically heals any invalid or generic voice URI back to the profile's Studio Neural Voice.
   */
  getSelectedNeuralVoiceName(profileKey = 'CHARLIE') {
    const profile = VOCAL_PROFILES[profileKey] || VOCAL_PROFILES.CHARLIE;
    const defaultNeural = profile.geminiVoice || 'Aoede';

    if (this.selectedVoiceURI) {
      if (VALID_NEURAL_VOICE_IDS.has(this.selectedVoiceURI)) {
        this.lockedVoicePersona = this.selectedVoiceURI;
        return this.selectedVoiceURI;
      }
      // Auto-heal invalid/generic voice URI back to Studio Neural Voice
      this.selectedVoiceURI = defaultNeural;
      this.voiceIntegrityStats.personaDriftFixed++;
      this.onVoiceIntegrityEvent({
        type: 'VOICE_PERSONA_DRIFT_FIXED',
        detail: `Restored Studio Neural Voice (${defaultNeural})`
      });
    }

    this.lockedVoicePersona = defaultNeural;
    return defaultNeural;
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
   * Records the tutor's spoken text AND specifically the tail (last 10 words + 4-char word stems) of the sentence
   * so any late speaker bleed of the final word or phrase is stripped or rejected immediately—even if STT alters a word slightly.
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
    this.lastTutorTailWordsList = allWords.slice(-10);
    this.lastTutorTailNormalized = this.lastTutorTailWordsList.join(' ');
    this.lastTutorTailWordSet = new Set(this.lastTutorTailWordsList.filter(w => w.length >= 2));
    this.lastTutorTailStems = new Set(
      this.lastTutorTailWordsList
        .filter(w => w.length >= 4 && !stopWords.has(w))
        .map(w => w.slice(0, 4))
    );
  }

  /**
   * Returns current script playback status so the Talking-Point Verification Layer can verify
   * whether the chatbot finished reading its script or what clause remained unread.
   */
  getScriptPlaybackProgress() {
    return {
      isBotSpeaking: this.isBotSpeaking,
      totalClauses: this.activeScriptClauses.length,
      completedClauses: this.activeClauseIndex,
      unspokenRemainderText: this.unspokenRemainderText || '',
      scriptCompleted: !this.unspokenRemainderText
    };
  }

  /**
   * Strips any leading words (or the entire phrase) if they match the last word/phrase of the tutor's speech,
   * including fuzzy word/stem overlap for 1–5 word tail echoes towards the end of the tutor's phrase.
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

    // 2. Fuzzy tail word & stem overlap for short 1–4 word echoes (e.g. "flat horizontal x-axis" -> STT hears "horizontal axis")
    if (normWords.length <= 4 && (this.lastTutorTailWordSet.size > 0 || this.lastTutorTailStems.size > 0)) {
      // Do not strip genuine standalone student answers like "yes", "no", "i dont know", or pure numbers not in the tail
      const isStudentIntentPhrase =
        /^(yes|yeah|yep|no|nope|nah|hint|help|wait|stop|i\s+dont\s+know|i\s+do\s+not\s+know|not\s+sure)$/i.test(
          fullNorm
        );
      if (!isStudentIntentPhrase) {
        let tailMatches = 0;
        let contentStemMatches = 0;
        let unmatchedContentWords = 0;
        for (const w of normWords) {
          const inTailWord = this.lastTutorTailWordSet.has(w);
          const inTailStem = w.length >= 4 && this.lastTutorTailStems.has(w.slice(0, 4));
          if (inTailWord || inTailStem) {
            tailMatches++;
          } else if (w.length >= 4) {
            unmatchedContentWords++;
          }
          if (inTailStem) {
            contentStemMatches++;
          }
        }
        // Single content word at the very end of the tutor's phrase (e.g. "intercepts" / "downward" / "balanced")
        if (normWords.length === 1 && normWords[0].length >= 4 && contentStemMatches === 1) {
          return '';
        }
        // 2–4 word phrase where >= 75% of words match the tutor's last 10 words and zero new content words appear
        if (
          normWords.length >= 2 &&
          unmatchedContentWords === 0 &&
          tailMatches / normWords.length >= 0.75 &&
          (tailMatches >= 2 || contentStemMatches >= 1)
        ) {
          return '';
        }
      }
    }

    // 3. Any 3+ word phrase contained verbatim anywhere in the tutor's last burst
    if (normWords.length >= 3 && this.lastTutorSpokenNormalized.includes(fullNorm)) {
      return '';
    }

    // 4. If the recognized string starts with 1–6 words from the tail of the tutor's sentence followed by user speech,
    // strip the leading tail echo words first and keep the user's words!
    let remainingRawWords = rawWords;
    if (this.lastTutorTailWordsList.length > 0 && rawWords.length > 1) {
      const articles = new Set(['the', 'a', 'an', 'it', 'is', 'my', 'our']);
      for (let prefixLen = Math.min(6, rawWords.length - 1); prefixLen >= 1; prefixLen--) {
        const prefixWords = rawWords
          .slice(0, prefixLen)
          .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
          .filter(Boolean);
        const prefixNorm = prefixWords.join(' ');
        const lastPrefixWord = prefixWords[prefixWords.length - 1] || '';
        const exactPrefixMatch =
          prefixNorm &&
          (this.lastTutorSpokenNormalized.endsWith(prefixNorm) ||
            (prefixLen >= 2 &&
              !articles.has(lastPrefixWord) &&
              this.lastTutorTailNormalized.includes(prefixNorm)));
        const fuzzyPrefixMatch =
          prefixWords.length >= 2 &&
          !articles.has(lastPrefixWord) &&
          prefixWords.every(
            w => this.lastTutorTailWordSet.has(w) || (w.length >= 4 && this.lastTutorTailStems.has(w.slice(0, 4)))
          );
        if (exactPrefixMatch || fuzzyPrefixMatch) {
          remainingRawWords = rawWords.slice(prefixLen);
          break;
        }
      }
    }

    // 5. High content-word overlap check on the remaining words
    const remNormWords = remainingRawWords
      .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
    const sigWords = remNormWords.filter(w => w.length >= 4);
    if (sigWords.length >= 3 && this.lastTutorSpokenWords.size > 0) {
      let matches = 0;
      for (const w of sigWords) {
        if (this.lastTutorSpokenWords.has(w) || this.lastTutorTailStems.has(w.slice(0, 4))) matches++;
      }
      if (matches / sigWords.length >= 0.7) {
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
    clearTimeout(this.micSettleTimer);
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
    clearTimeout(this.micSettleTimer);
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
   * Releases the speaker echo lock in two stages:
   *  Stage A (echoTailMs = 1000ms): Keeps mic hardware track muted while room reverb & speaker tail drain.
   *  Stage B (+250ms OS ring-buffer flush): Re-enables mic hardware track first, lets the OS audio buffer fill
   *          with clean post-speaker silence for 250ms, and only THEN starts a fresh SpeechRecognition instance.
   */
  releaseSpeakerEchoLock() {
    clearTimeout(this.resumeMicTimer);
    clearTimeout(this.micSettleTimer);
    this.clearPendingTranscript();
    this.lastBotSpeechEndTime = performance.now();
    this.echoCooldownUntil = this.lastBotSpeechEndTime + this.echoTailMs + 350;

    this.resumeMicTimer = setTimeout(() => {
      if (this.isBotSpeaking) return;

      this.clearPendingTranscript();

      if (this.micStream && this.isMicActive) {
        this.micStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
      }

      // Wait 250ms after track.enabled = true so Chromium's OS audio ring-buffer flushes any tail
      this.micSettleTimer = setTimeout(() => {
        if (this.isBotSpeaking) return;
        this.recognitionPausedForPlayback = false;
        this.clearPendingTranscript();

        if (this.isMicActive) {
          this.startWebSpeechRecognition();
        }

        this.onVadStateChange({
          isSpeaking: false,
          rms: 0,
          silenceMs: 0,
          isMutedForEcho: false
        });
      }, 250);
    }, this.echoTailMs);
  }

  stopVoiceIntegrityWatchdog() {
    if (this.voiceWatchdogTimer) {
      clearInterval(this.voiceWatchdogTimer);
      this.voiceWatchdogTimer = null;
    }
  }

  /**
   * Real-Time Voice Integrity Watchdog (runs every 250ms during speech):
   *  1. Detects & fixes simultaneous overlapping voices (`auditAndFixSimultaneousVoices`)
   *  2. Detects & blocks generic browser `window.speechSynthesis` (`blockGenericBrowserSpeechSynthesis`)
   *  3. Detects frozen/suspended AudioContext or stalled HTMLAudioElement and auto-resumes playback
   */
  startVoiceIntegrityWatchdog(genId, profileKey = 'CHARLIE') {
    this.stopVoiceIntegrityWatchdog();
    this.lastAudioProgressTs = performance.now();
    this.lastObservedAudioTime = -1;

    this.voiceWatchdogTimer = setInterval(() => {
      if (!this.isBotSpeaking || genId !== this.speechGenerationId) {
        this.stopVoiceIntegrityWatchdog();
        return;
      }

      // 1. Check & fix simultaneous multi-voice collision
      const collision = auditAndFixSimultaneousVoices();
      if (collision.collisionDetected) {
        this.voiceIntegrityStats.simultaneousVoicesFixed += collision.stoppedCount;
        this.onVoiceIntegrityEvent({
          type: 'SIMULTANEOUS_VOICES_FIXED',
          detail: `Stopped ${collision.stoppedCount} overlapping voice stream(s)`
        });
      }

      // 2. Check & block generic browser speechSynthesis
      if (blockGenericBrowserSpeechSynthesis()) {
        this.voiceIntegrityStats.genericVoiceBlocked++;
        this.onVoiceIntegrityEvent({
          type: 'GENERIC_VOICE_BLOCKED',
          detail: 'Canceled generic browser speechSynthesis during active session'
        });
      }

      // 3. Enforce locked Studio Neural Voice persona
      this.getSelectedNeuralVoiceName(profileKey);

      // 4. Check if AudioContext suspended or currentAudioEl stalled mid-phrase
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      const audio = this.currentAudioEl;
      if (audio && !audio.ended) {
        const now = performance.now();
        if (audio.currentTime !== this.lastObservedAudioTime && audio.currentTime > 0) {
          this.lastObservedAudioTime = audio.currentTime;
          this.lastAudioProgressTs = now;
        } else if (now - this.lastAudioProgressTs > 2400) {
          // Audio element has stalled mid-script for > 2.4s
          this.lastAudioProgressTs = now;
          if (audio.paused) {
            audio.play().catch(() => {});
          } else if (audio.duration && Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.15) {
            try {
              audio.onended?.();
            } catch (_) {}
          }
        }
      }
    }, 250);
  }

  stopSpeaking(reason = 'USER_STOP') {
    this.stopVoiceIntegrityWatchdog();

    if (this.ttsAbortController) {
      try {
        this.ttsAbortController.abort();
      } catch (_) {}
      this.ttsAbortController = null;
    }

    if (this.currentAudioEl) {
      const el = this.currentAudioEl;
      this.currentAudioEl = null;
      releaseVoiceChannel(el);
      try {
        el.onended = null;
        el.onerror = null;
        el.onplay = null;
        el.muted = true;
        el.volume = 0;
        el.pause();
        el.src = '';
      } catch (_) {}
    }

    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }

    if (reason === 'USER_STOP' || reason === 'USER_STOP_BUTTON' || reason === 'NEW_STUDENT_TURN') {
      this.unspokenRemainderText = '';
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

  async fetchTtsBlobUrl(textChunk, voiceName, signal, forceRefresh = false) {
    const resolvedVoice = VALID_NEURAL_VOICE_IDS.has(voiceName)
      ? voiceName
      : this.getSelectedNeuralVoiceName(this.activeProfile);
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
            voiceName: resolvedVoice,
            forceRefresh: forceRefresh || attempt > 1,
            apiKey: this.apiKey || undefined
          }),
          signal
        });
        if (!res.ok) {
          throw new Error(`TTS HTTP ${res.status}`);
        }
        const wavBlob = await res.blob();
        if (!wavBlob || wavBlob.size < 200) {
          throw new Error('Truncated WAV buffer');
        }
        return URL.createObjectURL(wavBlob);
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        lastErr = err;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 250 * attempt));
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
   * Plays a single WAV blob URL with:
   *  1. Exclusive Voice Channel mutex (`claimExclusiveVoiceChannel`) so two voices NEVER overlap
   *  2. Progress heartbeat (`ontimeupdate`) + duration safety timer so a hung `onended` never stalls mid-session
   */
  async playAudioClipSafely(audioUrl, { isFirstChunk = false, startTs = 0, abortSignal = null, genId = 0 } = {}) {
    if (abortSignal?.aborted || genId !== this.speechGenerationId) {
      URL.revokeObjectURL(audioUrl);
      return false;
    }

    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
    }
    this.currentAudioUrl = audioUrl;

    return new Promise((resolve, reject) => {
      const activeRate = Math.max(0.75, Math.min(1.5, Number(this.customRateMultiplier) || 1.1));
      const audio = new Audio(audioUrl);
      audio.defaultPlaybackRate = activeRate;
      audio.playbackRate = activeRate;
      audio.preservesPitch = true;

      // Claim exclusive voice channel immediately so zero other audio elements can play simultaneously
      claimExclusiveVoiceChannel(audio, 'CHAT_TUTOR');
      this.currentAudioEl = audio;
      this.lastAudioProgressTs = performance.now();
      this.lastObservedAudioTime = 0;

      let settled = false;
      let clipSafetyTimer = null;

      const finish = (ok, errObj = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(clipSafetyTimer);
        releaseVoiceChannel(audio);
        if (ok) resolve(true);
        else reject(errObj || new Error('Audio playback failed'));
      };

      // Safety ceiling in case browser never fires `onended`
      clipSafetyTimer = setTimeout(() => {
        finish(true);
      }, 28000);

      audio.onloadedmetadata = () => {
        if (audio.duration && Number.isFinite(audio.duration)) {
          clearTimeout(clipSafetyTimer);
          const expectedMs = Math.ceil((audio.duration / activeRate) * 1000) + 1800;
          clipSafetyTimer = setTimeout(() => {
            finish(true);
          }, Math.max(3000, expectedMs));
        }
      };

      audio.ontimeupdate = () => {
        this.lastAudioProgressTs = performance.now();
        this.lastObservedAudioTime = audio.currentTime;
      };

      audio.onplay = () => {
        const latestRate = Math.max(0.75, Math.min(1.5, Number(this.customRateMultiplier) || 1.1));
        audio.defaultPlaybackRate = latestRate;
        audio.playbackRate = latestRate;
        this.lastAudioProgressTs = performance.now();
        auditAndFixSimultaneousVoices();
        if (isFirstChunk) {
          this.onTtfaMeasured(Math.round(performance.now() - startTs));
        }
        this.isBotSpeaking = true;
        this.engageSpeakerEchoLock();
        this.onBotSpeakingChange(true);
      };

      audio.onended = () => {
        finish(true);
      };
      audio.onerror = (e) => {
        finish(false, e);
      };

      audio.play().catch((err) => {
        finish(false, err);
      });
    });
  }

  /**
   * Option 4 Zero-Delay Voice Emitter + Voice Integrity & Auto-Recovery Watchdog:
   * - Plays pre-bundled `firstChunkWavBase64` from `/api/chat` at 0.0s (instantaneous when transcript appears)
   *   while streaming `audioChunks[1]` in parallel from the server's pre-warm cache.
   * - Strictly uses Studio Neural Human Voice (e.g. Aoede); NEVER falls back to generic browser speechSynthesis.
   * - Automatically detects and heals mid-session voice stalls, failed clauses, or overlapping voices.
   */
  async speakCalibratedBurst(cleanText, profileKey = 'CHARLIE', prewarmedAudio = null) {
    const startTs = performance.now();
    const genId = ++this.speechGenerationId;
    this.stopSpeaking('NEW_BURST');

    const chunks =
      Array.isArray(prewarmedAudio?.audioChunks) && prewarmedAudio.audioChunks.length > 0
        ? prewarmedAudio.audioChunks
        : splitSpokenTextIntoClauses(cleanText, this.maxWords);

    if (chunks.length === 0) return;

    this.activeScriptClauses = [...chunks];
    this.activeClauseIndex = 0;
    this.unspokenRemainderText = chunks.join(' ');

    this.recordTutorSpokenFingerprint(chunks.join(' '));
    this.isBotSpeaking = true;
    this.engageSpeakerEchoLock();
    this.onBotSpeakingChange(true);

    const voiceName = this.getSelectedNeuralVoiceName(profileKey);
    const abortCtrl = new AbortController();
    this.ttsAbortController = abortCtrl;
    this.startVoiceIntegrityWatchdog(genId, profileKey);

    try {
      // Prepare URL promises for all chunks in parallel:
      // Chunk 0 uses inline base64 audio from `/api/chat` when available (0ms network wait!)
      const urlPromises = chunks.map((chunkText, idx) => {
        if (idx === 0 && prewarmedAudio?.firstChunkWavBase64) {
          return Promise.resolve(this.base64ToBlobUrl(prewarmedAudio.firstChunkWavBase64));
        }
        return this.fetchTtsBlobUrl(chunkText, voiceName, abortCtrl.signal).catch(() => null);
      });

      for (let i = 0; i < chunks.length; i++) {
        if (abortCtrl.signal.aborted || genId !== this.speechGenerationId) {
          return;
        }

        let audioUrl = await urlPromises[i];
        if (!audioUrl && !abortCtrl.signal.aborted && genId === this.speechGenerationId) {
          // Auto-heal: Retry fetching this clause with forceRefresh=true so the tutor never skips reading
          audioUrl = await this.fetchTtsBlobUrl(chunks[i], voiceName, abortCtrl.signal, true).catch(() => null);
        }

        if (!audioUrl || abortCtrl.signal.aborted || genId !== this.speechGenerationId) {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          break;
        }

        // Record fingerprint of the currently playing clause as well so any tail bleed matches immediately
        this.recordTutorSpokenFingerprint(chunks.slice(0, i + 1).join(' '));

        try {
          await this.playAudioClipSafely(audioUrl, {
            isFirstChunk: i === 0,
            startTs,
            abortSignal: abortCtrl.signal,
            genId
          });
          this.activeClauseIndex = i + 1;
          this.unspokenRemainderText = chunks.slice(i + 1).join(' ').trim();
        } catch (_) {
          // Auto-heal: If playback of clause `i` glitched mid-stream, re-synthesize and play with forceRefresh=true
          if (!abortCtrl.signal.aborted && genId === this.speechGenerationId) {
            const retryUrl = await this.fetchTtsBlobUrl(chunks[i], voiceName, abortCtrl.signal, true).catch(() => null);
            if (retryUrl && !abortCtrl.signal.aborted && genId === this.speechGenerationId) {
              await this.playAudioClipSafely(retryUrl, {
                isFirstChunk: i === 0,
                startTs,
                abortSignal: abortCtrl.signal,
                genId
              }).catch(() => {});
              this.activeClauseIndex = i + 1;
              this.unspokenRemainderText = chunks.slice(i + 1).join(' ').trim();
              this.voiceIntegrityStats.stalledScriptsRecovered++;
              this.onVoiceIntegrityEvent({
                type: 'SCRIPT_CLAUSE_RECOVERED',
                detail: `Auto-recovered clause ${i + 1} of ${chunks.length}`
              });
            }
          }
        }
      }

      // Final Unread Script Verification & Auto-Recovery:
      // If any remainder of the script was left unread (and user did NOT abort), synthesize and play it automatically!
      if (this.unspokenRemainderText && !abortCtrl.signal.aborted && genId === this.speechGenerationId) {
        const remainderToRead = this.unspokenRemainderText;
        const recoveryUrl = await this.fetchTtsBlobUrl(remainderToRead, voiceName, abortCtrl.signal, true).catch(
          () => null
        );
        if (recoveryUrl && !abortCtrl.signal.aborted && genId === this.speechGenerationId) {
          await this.playAudioClipSafely(recoveryUrl, {
            isFirstChunk: false,
            startTs,
            abortSignal: abortCtrl.signal,
            genId
          }).catch(() => {});
          this.unspokenRemainderText = '';
          this.voiceIntegrityStats.stalledScriptsRecovered++;
          this.onVoiceIntegrityEvent({
            type: 'UNREAD_SCRIPT_RECOVERED',
            detail: 'Auto-recovered unread script remainder'
          });
        }
      }

      if (!abortCtrl.signal.aborted && genId === this.speechGenerationId) {
        this.unspokenRemainderText = '';
        this.stopVoiceIntegrityWatchdog();
        this.isBotSpeaking = false;
        this.onBotSpeakingChange(false);
        this.releaseSpeakerEchoLock();
      }
    } catch (err) {
      if (err?.name === 'AbortError' || abortCtrl.signal.aborted || genId !== this.speechGenerationId) return;
      console.warn('Studio Neural TTS error (generic browser voice fallback is strictly disabled):', err);
      this.stopVoiceIntegrityWatchdog();
      this.isBotSpeaking = false;
      this.onBotSpeakingChange(false);
      this.releaseSpeakerEchoLock();
    }
  }
}
