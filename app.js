/**
 * Ontario STEM Socratic Voice Tutor — Tri-Channel HUD, Interactive Graph, Pause Detector & Manim Video Controller
 * Includes:
 *  1. Strict Pre-Render LaTeX Screening Layer (`sanitizeLatexForHud`) + Clean History Normalization
 *  2. Stoppable / Pausable Deliberation Timer (`⏸ Pause`, `⏹ Stop Timer`, auto-stop at t_expected)
 *  3. High-Density Compact Chat Layout
 *  4. Context-Aware Varied Check-In Messages (`generateContextualCheckIn`)
 *  5. Open-Source Interactive Graphing Engine (`createInteractiveGraphElement`) embedded in chat bubbles
 *  6. Smart Speech Pause Detector Device (acoustic + clause-aware pause meter + Hold Mode)
 *  7. End-of-Session Manim Instructional Video Offer & Synchronized Voice Canvas Player (`createManimVideoElement`)
 */

import {
  VOCAL_PROFILES,
  NEURAL_HUMAN_VOICES,
  FLIGHT_MODES,
  STEP_TIERS,
  DEFAULT_TELEMETRY,
  STEM_SCENARIOS,
  sanitizeLatexForHud,
  buildSystemInstruction,
  parseTriChannelPacket,
  isGraphRequestedByUser,
  buildFallbackGraphSpec,
  detectManimConsentIntent,
  computeRetroactiveAttribution,
  generateContextualCheckIn,
  generateFallbackLearningGapAnalysis,
  generateStage2ConceptOffer,
  generateNextQuestionPrompt,
  detectSystemCommand,
  generateOfflineSocraticResponse
} from './svs-engine.js';

import { AudioAvionicsController } from './audio-avionics.js';
import { createInteractiveGraphElement } from './graph-engine.js';
import { createManimVideoElement } from './manim-engine.js';

class SocraticGeminiChatApp {
  constructor() {
    this.activeProfileKey = 'CHARLIE';
    this.activeModeId = 1;
    this.maxWords = 30;
    this.geminiApiKey = '';
    this.conversationHistory = [];
    this.lastSpokenBurst = 'Hi there! What Ontario high school math, physics, or chemistry problem are we solving today?';
    this.lastStudentUtterance = '';
    this.lastHudLatex = '';
    this.lastGraphSpec = null;

    // End-of-Session Manim Consent State & Stage 2 Concept Explanation State
    this.awaitingManimConsent = false;
    this.awaitingConceptConsent = false;
    this.activeManimController = null;
    this.latestLearningGap = null;

    // Section 10 & 20: Telemetry & Two-Stage Deliberation Timer State
    this.currentTelemetry = { ...DEFAULT_TELEMETRY };
    this.autoScratchpadPing = true;
    this.isTimerPaused = false;
    this.pausedElapsedSec = 0;
    this.delibStartTimestamp = 0;
    this.delibInterval = null;
    this.delibStage = 0; // 0 = waiting for Stage 1 check-in (15s), 1 = running second 15s timer for Stage 2 concept offer, 2 = Stage 2 offered
    this.hasActiveProblemTurn = false;

    this.isBotSpeaking = false;
    this.isUserSpeaking = false;
    this.isMutedForEcho = false;

    this.avionics = new AudioAvionicsController({
      onVadStateChange: (vad) => this.handleVadUpdate(vad),
      onPauseDetectorUpdate: (state) => this.handlePauseDetectorUI(state),
      onInterimTranscript: (interim) => {
        const input = document.getElementById('studentInput');
        if (input) input.value = interim;
        // Reset deliberation timer while student is actively speaking words
        this.delibStartTimestamp = performance.now();
      },
      onSpeechRecognized: (finalText) => {
        const input = document.getElementById('studentInput');
        if (input) input.value = '';
        this.processStudentTransmission(finalText);
      },
      onBotSpeakingChange: (speaking) => {
        this.isBotSpeaking = speaking;
        const stopBtn = document.getElementById('btnBargeIn');
        if (stopBtn) stopBtn.hidden = !speaking;
        this.updateMicStatusUI();

        if (!speaking && this.hasActiveProblemTurn && this.delibStage < 2 && this.autoScratchpadPing) {
          this.startScratchpadDeliberationClock();
        }
      }
    });

    this.initUI();
    this.updateTelemetryUI(this.currentTelemetry);

    this.appendChatMessage(
      'svs',
      'Hi! I am your Ontario high school STEM tutor with interactive graphing, step-by-step visual solution videos, and natural voice guidance. Pick a starter problem below or ask any STEM question.',
      `${VOCAL_PROFILES[this.activeProfileKey].code} • ${FLIGHT_MODES[this.activeModeId].name}`,
      ''
    );
  }

  initUI() {
    this.renderModePills();
    this.renderPersonaButtons();
    this.renderStarterChips();
    this.populateVoiceDropdown();

    const drawer = document.getElementById('paramsDrawer');
    document.getElementById('btnToggleParams').addEventListener('click', () => {
      drawer.hidden = !drawer.hidden;
    });
    document.getElementById('btnCloseParams').addEventListener('click', () => {
      drawer.hidden = true;
    });

    // Top Bar: Plot Interactive Graph on Demand
    const btnPlotCurrent = document.getElementById('btnPlotCurrent');
    if (btnPlotCurrent) {
      btnPlotCurrent.addEventListener('click', () => {
        this.plotCurrentGraphInChat();
      });
    }

    // Top Bar: End Session & Offer Manim Video on Demand
    const btnOfferManim = document.getElementById('btnOfferManim');
    if (btnOfferManim) {
      btnOfferManim.addEventListener('click', () => {
        this.offerEndOfSessionManimVideo();
      });
    }

    const btnToggleMic = document.getElementById('btnToggleMic');
    btnToggleMic.addEventListener('click', async () => {
      if (this.avionics.isMicActive) {
        this.avionics.stopMicrophone();
        this.updateMicStatusUI();
      } else {
        const ok = await this.avionics.startMicrophone();
        if (!ok) {
          this.appendChatMessage(
            'svs',
            'I could not access your microphone. Please allow microphone access in your browser, or type your question below.',
            'Microphone Notice',
            ''
          );
        }
        this.updateMicStatusUI();
      }
    });

    // Smart Speech Pause Detector Controls: Hold Mode & Send Now
    const btnToggleHoldMode = document.getElementById('btnToggleHoldMode');
    if (btnToggleHoldMode) {
      btnToggleHoldMode.addEventListener('click', () => {
        const nextHold = !this.avionics.manualSendHoldMode;
        this.avionics.setManualHoldMode(nextHold);
        btnToggleHoldMode.classList.toggle('active', nextHold);
        btnToggleHoldMode.textContent = nextHold
          ? '🔒 Hold Mode (Manual Send)'
          : '🔓 Auto-Send Pause';
      });
    }

    const btnFlushSpeechNow = document.getElementById('btnFlushSpeechNow');
    if (btnFlushSpeechNow) {
      btnFlushSpeechNow.addEventListener('click', () => {
        this.avionics.flushPendingSpeechNow();
      });
    }

    document.getElementById('btnBargeIn').addEventListener('click', () => {
      this.avionics.stopSpeaking('USER_STOP_BUTTON');
      if (this.activeManimController) {
        this.activeManimController.stop();
      }
    });

    document.getElementById('btnReplayLast').addEventListener('click', () => {
      if (this.lastSpokenBurst) {
        this.avionics.speakCalibratedBurst(this.lastSpokenBurst, this.activeProfileKey);
      }
    });

    // Direct Timer Pause / Resume Button on Top Strip
    const btnPauseTimer = document.getElementById('btnPauseTimer');
    btnPauseTimer.addEventListener('click', () => {
      if (!this.autoScratchpadPing) {
        this.setTimerEnabled(true);
        return;
      }
      this.togglePauseDeliberationClock();
    });

    // Direct Timer Stop / Enable Button on Top Strip
    const btnStopTimer = document.getElementById('btnStopTimer');
    btnStopTimer.addEventListener('click', () => {
      this.setTimerEnabled(!this.autoScratchpadPing);
    });

    // Test Context-Aware Check-In Button in Sidebar
    document.getElementById('btnTriggerSoftPing').addEventListener('click', () => {
      this.triggerScratchpadSoftPing('MANUAL_TEST');
    });

    // Enable Deliberation Timer Checkbox in Sidebar
    document.getElementById('chkScratchpadPing').addEventListener('change', (e) => {
      this.setTimerEnabled(e.target.checked);
    });

    // Reset timer while student is typing in the text box so it doesn't interrupt typing
    document.getElementById('studentInput').addEventListener('keydown', () => {
      if (this.delibInterval && !this.isTimerPaused) {
        this.delibStartTimestamp = performance.now();
      }
    });

    document.getElementById('btnClearLog').addEventListener('click', () => {
      if (this.activeManimController) {
        this.activeManimController.stop();
        this.activeManimController = null;
      }
      this.conversationHistory = [];
      this.stopScratchpadDeliberationClock();
      this.hasActiveProblemTurn = false;
      this.delibStage = 0;
      this.awaitingManimConsent = false;
      this.awaitingConceptConsent = false;
      this.latestLearningGap = null;
      this.lastHudLatex = '';
      this.lastGraphSpec = null;
      this.currentTelemetry = { ...DEFAULT_TELEMETRY };
      this.updateTelemetryUI(this.currentTelemetry);
      document.getElementById('commsLog').innerHTML = '';
      document.getElementById('liveHudBanner').hidden = true;
      this.appendChatMessage(
        'svs',
        'Started a fresh study session! Pick a problem below or ask any STEM question.',
        `${VOCAL_PROFILES[this.activeProfileKey].code} • ${FLIGHT_MODES[this.activeModeId].name}`,
        ''
      );
    });

    document.getElementById('commsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      // If speech recognition has buffered words in Hold Mode, flush them first
      if (this.avionics.hasBufferedSpeech()) {
        this.avionics.flushPendingSpeechNow();
        return;
      }
      const input = document.getElementById('studentInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      this.processStudentTransmission(text);
    });

    document.getElementById('voiceSelectDropdown').addEventListener('change', (e) => {
      this.avionics.selectedVoiceURI = e.target.value;
      this.updateActiveVoiceHint();
    });

    document.getElementById('chkEchoGuard').addEventListener('change', (e) => {
      this.avionics.echoProtectionEnabled = e.target.checked;
      this.updateMicStatusUI();
    });

    const maxWordsSlider = document.getElementById('maxWordsSlider');
    maxWordsSlider.addEventListener('input', () => {
      this.maxWords = Number(maxWordsSlider.value);
      this.avionics.maxWords = this.maxWords;
      document.getElementById('maxWordsValue').textContent = `${this.maxWords} words`;
    });

    const rateSlider = document.getElementById('rateSlider');
    rateSlider.addEventListener('input', () => {
      const val = Number(rateSlider.value);
      this.avionics.customRateMultiplier = val;
      if (this.avionics.currentAudioEl) {
        this.avionics.currentAudioEl.defaultPlaybackRate = val;
        this.avionics.currentAudioEl.playbackRate = val;
      }
      if (this.activeManimController?.setPlaybackRate) {
        this.activeManimController.setPlaybackRate(val);
      }
      document.getElementById('rateValue').textContent = `${val.toFixed(2)}×`;
    });

    const pitchSlider = document.getElementById('pitchSlider');
    pitchSlider.addEventListener('input', () => {
      const val = Number(pitchSlider.value);
      this.avionics.customPitchMultiplier = val;
      document.getElementById('pitchValue').textContent = val.toFixed(2);
    });

    const vadSlider = document.getElementById('vadThresholdSlider');
    vadSlider.addEventListener('input', () => {
      const ms = Number(vadSlider.value);
      this.avionics.vadSilenceThresholdMs = ms;
      document.getElementById('vadThresholdValue').textContent = `${(ms / 1000).toFixed(1)} s`;
    });

    const saveBtn = document.getElementById('btnSaveConfig');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.geminiApiKey = document.getElementById('geminiApiKeyInput').value.trim();
        this.avionics.apiKey = this.geminiApiKey;
        document.getElementById('engineStatusBadge').textContent =
          'Active: Gemini 2.5 Flash + Tri-Channel Engine';
      });
    }
  }

  /**
   * Updates the Smart Speech Pause Detector pill above the input bar
   */
  handlePauseDetectorUI(state) {
    const pill = document.getElementById('pauseDetectorPill');
    const label = document.getElementById('pauseDetectorLabel');
    const fill = document.getElementById('pauseDetectorFill');
    const sendNowBtn = document.getElementById('btnFlushSpeechNow');
    if (!pill || !label || !fill) return;

    if (!state.active && !state.holdMode) {
      pill.hidden = true;
      fill.style.width = '0%';
      if (sendNowBtn) sendNowBtn.hidden = true;
      return;
    }

    if (state.holdMode && !state.active) {
      pill.hidden = false;
      label.textContent = 'Hold Mode: Speak freely — click Send when finished';
      fill.style.width = '0%';
      if (sendNowBtn) sendNowBtn.hidden = true;
      return;
    }

    pill.hidden = false;
    if (sendNowBtn) sendNowBtn.hidden = false;

    if (state.holdMode) {
      label.textContent = 'Hold Mode: Capturing speech (click Send Now when done)';
      fill.style.width = '100%';
      fill.style.backgroundColor = '#fdd663';
      return;
    }

    const pct = Math.min(100, Math.round((state.progress || 0) * 100));
    fill.style.width = `${pct}%`;

    if (state.status === 'SPEAKING') {
      label.textContent = state.extendedForClause
        ? 'Listening (mid-sentence pause grace active)...'
        : 'Listening to your explanation...';
      fill.style.backgroundColor = '#81c995';
    } else if (state.status === 'PAUSE_COUNTDOWN') {
      const remainSec = Math.max(0, ((state.targetMs - state.elapsedMs) / 1000)).toFixed(1);
      label.textContent = state.extendedForClause
        ? `Mid-thought pause detected — waiting ${remainSec}s`
        : `Pause detected — sending in ${remainSec}s`;
      fill.style.backgroundColor = '#a8c7fa';
    }
  }

  /**
   * Plots the current or most recent equation in an interactive graph card in the chat
   */
  plotCurrentGraphInChat() {
    const spec =
      this.lastGraphSpec ||
      buildFallbackGraphSpec(this.lastStudentUtterance, this.lastHudLatex || 'x^2 - 4');
    this.lastGraphSpec = spec;

    const spoken = `Here is the interactive graph for ${spec.title || 'our function'}. You can drag to pan, scroll to zoom, hover to inspect roots and extrema, or add another function below.`;
    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    this.appendChatMessage(
      'svs',
      spoken,
      `${profile.code} (${voiceName}) • Interactive Graph Engine`,
      this.lastHudLatex,
      { graphSpec: spec }
    );
    this.lastSpokenBurst = spoken;
    this.avionics.speakCalibratedBurst(spoken, this.activeProfileKey);
  }

  /**
   * Stops the deliberation timer and marks the current question session as complete
   * so the timer never triggers 'Take your time...' while offering/playing the video or waiting for the next question.
   */
  markQuestionSessionCompleted(statusText = 'Session Complete') {
    this.stopScratchpadDeliberationClock();
    this.hasActiveProblemTurn = false;
    this.delibStage = 2;
    this.awaitingConceptConsent = false;
    this.isTimerPaused = false;
    this.pausedElapsedSec = 0;

    const timerEl = document.getElementById('stripScratchpadTimer');
    const fillEl = document.getElementById('stripScratchpadFill');
    if (timerEl) {
      timerEl.textContent = statusText;
    }
    if (fillEl) {
      fillEl.style.width = '0%';
    }
  }

  /**
   * Explicitly ends the current question session and asks the user if they want a step-by-step solution video
   */
  offerEndOfSessionManimVideo() {
    this.markQuestionSessionCompleted('Session Complete');
    this.awaitingManimConsent = true;
    const spoken =
      'Great work completing this problem! Would you like to watch a full step-by-step solution video with voice explanation for the question we just solved?';
    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    this.appendChatMessage(
      'svs',
      spoken,
      `${profile.code} (${voiceName}) • Session Complete`,
      this.lastHudLatex,
      { offerManim: true }
    );
    this.lastSpokenBurst = spoken;
    this.avionics.speakCalibratedBurst(spoken, this.activeProfileKey);
  }

  /**
   * Handles the user's YES or NO response to the End-of-Session solution video prompt
   */
  async handleManimConsentDecision(decision) {
    this.awaitingManimConsent = false;
    this.markQuestionSessionCompleted(
      decision === 'NO' ? 'Ready for Next Question' : 'Playing Solution Video'
    );

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    if (decision === 'NO') {
      const noReply = generateNextQuestionPrompt();
      this.appendChatMessage(
        'svs',
        noReply,
        `${profile.code} (${voiceName}) • Ready for Next Question`,
        ''
      );
      this.lastSpokenBurst = noReply;
      this.avionics.speakCalibratedBurst(noReply, this.activeProfileKey);
      return;
    }

    // Stop any current speech before generating and playing the video
    this.avionics.stopSpeaking('START_SOLUTION_VIDEO');

    // User chose YES -> Generate Step-by-Step Solution Storyboard and render Video Player in chat
    const loadingRow = this.appendThinkingBubble(
      `Preparing step-by-step visual solution & ${voiceName} voice explanation...`
    );

    try {
      const storyboard = await this.fetchManimStoryboard();
      loadingRow.remove();

      this.markQuestionSessionCompleted('Playing Solution Video');
      const introText = `Here is the complete step-by-step solution for "${storyboard.title}". Use the Step buttons below the screen to review any part at your own pace.`;
      this.appendChatMessage(
        'svs',
        introText,
        `${profile.code} (${voiceName}) • Step-by-Step Solution Video`,
        '',
        { manimStoryboard: storyboard }
      );
    } catch (err) {
      loadingRow.remove();
      console.warn('Solution video generation fallback:', err);
      this.markQuestionSessionCompleted('Playing Solution Video');
      const fallbackStoryboard = this.buildClientFallbackManimStoryboard();
      this.appendChatMessage(
        'svs',
        `Here is the complete step-by-step solution for "${fallbackStoryboard.title}". Use the Step buttons below the screen to review any part at your own pace.`,
        `${profile.code} (${voiceName}) • Step-by-Step Solution Video`,
        '',
        { manimStoryboard: fallbackStoryboard }
      );
    }
  }

  /**
   * Called automatically once the step-by-step solution video finishes playing in the chat window.
   * Recognizes the question is complete, keeps the deliberation timer stopped, and asks a varied follow-up question.
   */
  handleSolutionVideoCompleted(completedStoryboard = {}) {
    this.markQuestionSessionCompleted('Ready for Next Question');

    const followUpPrompt = generateNextQuestionPrompt(completedStoryboard?.title || '');
    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    this.appendChatMessage(
      'svs',
      followUpPrompt,
      `${profile.code} (${voiceName}) • Question Complete`,
      ''
    );
    this.lastSpokenBurst = followUpPrompt;
    this.avionics.speakCalibratedBurst(followUpPrompt, this.activeProfileKey);
  }

  async fetchManimStoryboard() {
    const topicHint =
      this.lastStudentUtterance ||
      this.lastHudLatex ||
      'Ontario Secondary STEM Problem Walkthrough';
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    const res = await fetch('/api/manim-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: this.conversationHistory,
        topicHint,
        voiceName,
        apiKey: this.geminiApiKey || undefined
      })
    });

    if (!res.ok) {
      throw new Error(`Manim script HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.storyboard || !Array.isArray(data.storyboard.scenes)) {
      throw new Error('Invalid storyboard payload');
    }
    return data.storyboard;
  }

  buildClientFallbackManimStoryboard() {
    const cleanLatex = sanitizeLatexForHud(this.lastHudLatex || '2x^2 + 5x + 2 = 0');
    const fnExpr =
      this.lastGraphSpec?.functions?.[0]?.expr ||
      (typeof this.lastGraphSpec?.functions?.[0] === 'string' ? this.lastGraphSpec.functions[0] : '') ||
      '2*x^2 + 5*x + 2';

    return {
      title: 'Step-by-Step Solution & Concept Proof',
      course: 'Ontario STEM',
      xDomain: [-5, 4],
      yDomain: [-4, 10],
      scenes: [
        {
          heading: 'Step 1: Standard Form & Coefficients',
          conceptTag: 'Quadratic Form: ax² + bx + c = 0',
          latex: cleanLatex,
          table: {
            headers: ['Parameter', 'Value', 'Term Role'],
            rows: [
              ['a', '2', 'Leading (x²)'],
              ['b', '5', 'Linear (x)'],
              ['c', '2', 'Constant y-int']
            ]
          },
          narration: 'We begin our formal solution by writing the quadratic equation in standard form and identifying its exact coefficients: leading coefficient a equals two, linear coefficient b equals five, and constant c equals two.',
          graphExpr: fnExpr,
          highlightPoint: [0, 2]
        },
        {
          heading: 'Step 2: Product-Sum Decomposition',
          conceptTag: 'Rule: Find p, q where p · q = a · c and p + q = b',
          latex: 'a \\cdot c = 4, \\quad b = 5 \\implies p = 4,\\; q = 1',
          table: {
            headers: ['Factor Pair (p, q)', 'Product (p · q)', 'Sum (p + q)'],
            rows: [
              ['4 and 1', '4 ✓', '5 ✓ (Selected)'],
              ['2 and 2', '4 ✓', '4 ✗']
            ]
          },
          narration: 'By the decomposition method, we multiply the leading coefficient a by the constant c to obtain four. Testing factor pairs in our table, four and one multiply to positive four and sum to positive five.',
          graphExpr: fnExpr,
          highlightPoint: [-1.25, -1.125]
        },
        {
          heading: 'Step 3: Splitting the Linear Term & Grouping',
          conceptTag: 'Rewrite 5x as 4x + x and factor each pair',
          latex: '2x^2 + 4x + x + 2 = 0 \\implies 2x(x + 2) + 1(x + 2) = 0',
          annotation: 'Shared binomial factor (x + 2) appears in both grouped terms.',
          narration: 'Next, we rewrite the middle term five x as four x plus one x. Factoring by grouping extracts two x from the first pair and positive one from the second pair, revealing the shared binomial factor x plus two.',
          graphExpr: fnExpr,
          highlightPoint: [-2, 0]
        },
        {
          heading: 'Step 4: Zero-Product Property & Verified Roots',
          conceptTag: 'Set each linear factor equal to zero',
          latex: '(2x + 1)(x + 2) = 0 \\implies x_1 = -0.5, \\quad x_2 = -2',
          table: {
            headers: ['Linear Factor', 'Algebraic Root', 'Graph Intercept'],
            rows: [
              ['2x + 1 = 0', 'x = -0.5', '(-0.5, 0)'],
              ['x + 2 = 0', 'x = -2', '(-2, 0)']
            ]
          },
          narration: 'Setting each factor to zero yields our final verified solutions: x equals negative zero point five, and x equals negative two, which correspond directly to the x-intercepts highlighted on the graph.',
          graphExpr: fnExpr,
          highlightPoint: [-0.5, 0]
        }
      ]
    };
  }

  /**
   * Enables or completely stops/disables the Deliberation Timer
   */
  setTimerEnabled(enabled) {
    this.autoScratchpadPing = Boolean(enabled);
    const chk = document.getElementById('chkScratchpadPing');
    if (chk) chk.checked = this.autoScratchpadPing;

    const btnStop = document.getElementById('btnStopTimer');
    const btnPause = document.getElementById('btnPauseTimer');
    const timerEl = document.getElementById('stripScratchpadTimer');
    const fillEl = document.getElementById('stripScratchpadFill');
    const tierObj = STEP_TIERS[this.currentTelemetry.step_tier] || STEP_TIERS[1];

    if (!this.autoScratchpadPing) {
      this.stopScratchpadDeliberationClock();
      this.isTimerPaused = false;
      if (btnStop) {
        btnStop.textContent = '▶ Enable Timer';
        btnStop.classList.add('stopped');
      }
      if (btnPause) {
        btnPause.textContent = '⏸ Pause';
        btnPause.classList.remove('paused');
      }
      if (timerEl) timerEl.textContent = `OFF (${tierObj.expectedSec}s)`;
      if (fillEl) fillEl.style.width = '0%';
    } else {
      if (btnStop) {
        btnStop.textContent = '⏹ Stop Timer';
        btnStop.classList.remove('stopped');
      }
      if (timerEl) timerEl.textContent = `0.0s / ${tierObj.expectedSec}s`;
      if (this.hasActiveProblemTurn && !this.isBotSpeaking && this.delibStage < 2) {
        this.startScratchpadDeliberationClock();
      }
    }
  }

  togglePauseDeliberationClock() {
    const btnPause = document.getElementById('btnPauseTimer');
    if (!this.isTimerPaused) {
      this.isTimerPaused = true;
      this.pausedElapsedSec = this.getElapsedDeliberationSeconds();
      this.stopScratchpadDeliberationClock();
      if (btnPause) {
        btnPause.textContent = '▶ Resume';
        btnPause.classList.add('paused');
      }
    } else {
      this.isTimerPaused = false;
      if (btnPause) {
        btnPause.textContent = '⏸ Pause';
        btnPause.classList.remove('paused');
      }
      if (this.hasActiveProblemTurn && this.autoScratchpadPing) {
        this.startScratchpadDeliberationClock(this.pausedElapsedSec);
      }
    }
  }

  /**
   * Two-Stage Deliberation Clock:
   * - Stage 0 (first cycle, e.g. 15s for Tier 2): Delivers encouraging check-in message, then transitions to Stage 1.
   * - Stage 1 (second cycle, another 15s): Suggests if the user wants the chatbot to explain the underlying concept.
   */
  startScratchpadDeliberationClock(resumeFromSeconds = 0) {
    this.stopScratchpadDeliberationClock();
    if (!this.autoScratchpadPing || this.isTimerPaused || this.delibStage >= 2) return;

    this.delibStartTimestamp = performance.now() - resumeFromSeconds * 1000;
    const tierObj = STEP_TIERS[this.currentTelemetry.step_tier] || STEP_TIERS[1];
    // Stage 0 uses the tier's expectedSec (15s for Tier 2); Stage 1 runs another 15s countdown
    const expectedSec = this.delibStage === 1 ? 15 : tierObj.expectedSec;

    this.delibInterval = setInterval(() => {
      if (!this.autoScratchpadPing || this.isTimerPaused) {
        this.stopScratchpadDeliberationClock();
        return;
      }

      if (this.isBotSpeaking) {
        this.delibStartTimestamp = performance.now();
        return;
      }

      const elapsedSec = Math.min(expectedSec, (performance.now() - this.delibStartTimestamp) / 1000);
      const pct = Math.min(100, (elapsedSec / expectedSec) * 100);

      const timerEl = document.getElementById('stripScratchpadTimer');
      const fillEl = document.getElementById('stripScratchpadFill');
      if (timerEl) {
        const prefix = this.delibStage === 1 ? 'Stage 2: ' : '';
        timerEl.textContent = `${prefix}${elapsedSec.toFixed(1)}s / ${expectedSec}s`;
      }
      if (fillEl) {
        fillEl.style.width = `${pct}%`;
        fillEl.style.backgroundColor =
          elapsedSec >= expectedSec ? '#fdd663' : this.delibStage === 1 ? '#f28b82' : '#a8c7fa';
      }

      if (elapsedSec >= 4.0 && this.currentTelemetry.delib_state === 'IMMEDIATE') {
        this.currentTelemetry.delib_state = 'SCRATCHPAD_ACTIVE';
        this.updateDelibBadgeUI('SCRATCHPAD_ACTIVE');
      }

      if (elapsedSec >= expectedSec) {
        this.stopScratchpadDeliberationClock();
        if (this.delibStage === 0) {
          // Stage 1 complete -> Issue encouraging check-in; onBotSpeakingChange(false) will automatically start Stage 2 (another 15s)
          this.delibStage = 1;
          this.triggerScratchpadSoftPing('AUTO_STAGE_1');
        } else if (this.delibStage === 1) {
          // Stage 2 complete (second 15s expired) -> Offer to explain the underlying concept
          this.delibStage = 2;
          this.triggerStage2ConceptOffer();
        }
      }
    }, 200);
  }

  stopScratchpadDeliberationClock() {
    if (this.delibInterval) {
      clearInterval(this.delibInterval);
      this.delibInterval = null;
    }
  }

  getElapsedDeliberationSeconds() {
    if (this.isTimerPaused) return this.pausedElapsedSec;
    if (!this.delibStartTimestamp) return 0;
    return Math.max(0, (performance.now() - this.delibStartTimestamp) / 1000);
  }

  /**
   * Stage 1: Issues a context-aware, varied supportive check-in tailored to the current conversation.
   * Once the voice finishes speaking this message, `onBotSpeakingChange(false)` automatically runs the timer a second time (15s).
   */
  triggerScratchpadSoftPing(reason = 'AUTO_STAGE_1') {
    if (reason === 'MANUAL_TEST') {
      this.hasActiveProblemTurn = true;
      this.delibStage = 1;
    }

    const checkInPacket = generateContextualCheckIn({
      activeTier: this.currentTelemetry.step_tier,
      lastHudLatex: this.lastHudLatex,
      lastTutorQuestion: this.lastSpokenBurst,
      lastStudentMessage: this.lastStudentUtterance,
      modeId: this.activeModeId
    });

    this.currentTelemetry = checkInPacket.telemetry;
    this.updateTelemetryUI(this.currentTelemetry);

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const footerTag = `${profile.code} (${voiceName}) • Stage 1 Check-In (${reason === 'MANUAL_TEST' ? 'Test' : '15s Deliberation'})`;

    this.appendChatMessage('svs', checkInPacket.spokenText, footerTag, '');
    this.lastSpokenBurst = checkInPacket.spokenText;
    this.avionics.speakCalibratedBurst(checkInPacket.spokenText, this.activeProfileKey);
  }

  /**
   * Stage 2 (after the second 15s timer expires):
   * Suggests if the user wants the chatbot to explain the underlying concept, using the behind-the-scenes learning-gap diagnosis.
   */
  triggerStage2ConceptOffer() {
    this.awaitingConceptConsent = true;
    const offerPacket = generateStage2ConceptOffer({
      activeTier: this.currentTelemetry.step_tier,
      lastHudLatex: this.lastHudLatex,
      lastTutorQuestion: this.lastSpokenBurst,
      lastStudentMessage: this.lastStudentUtterance,
      gapAnalysis: this.latestLearningGap
    });

    this.currentTelemetry = offerPacket.telemetry;
    this.updateTelemetryUI(this.currentTelemetry);

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const footerTag = `${profile.code} (${voiceName}) • Stage 2 Concept Offer • Learning Gap: ${offerPacket.missingConcept}`;

    this.appendChatMessage('svs', offerPacket.spokenText, footerTag, '', {
      offerConcept: true,
      missingConcept: offerPacket.missingConcept
    });
    this.lastSpokenBurst = offerPacket.spokenText;
    this.avionics.speakCalibratedBurst(offerPacket.spokenText, this.activeProfileKey);
  }

  /**
   * Handles the student's Yes/No decision when asked if they want the chatbot to explain the concept.
   * Incorporates the behind-the-scenes learning-gap analysis directly into the explanation.
   */
  async handleConceptExplanationDecision(decision) {
    this.awaitingConceptConsent = false;
    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    if (decision === 'NO') {
      const noReply = 'Sounds good! Take your time working through the step, and let me know whenever you are ready.';
      this.appendChatMessage(
        'svs',
        noReply,
        `${profile.code} (${voiceName}) • Continuing Practice`,
        ''
      );
      this.lastSpokenBurst = noReply;
      this.avionics.speakCalibratedBurst(noReply, this.activeProfileKey);
      return;
    }

    // Student accepted Concept Explanation -> Use pre-analyzed learning gap to explain the missing concept & bridge to the current step
    const gap =
      this.latestLearningGap ||
      generateFallbackLearningGapAnalysis({
        lastHudLatex: this.lastHudLatex,
        lastTutorQuestion: this.lastSpokenBurst,
        lastStudentMessage: this.lastStudentUtterance
      });

    const hudToDisplay = sanitizeLatexForHud(gap.conceptExplanationHud || this.lastHudLatex);
    const spokenExplanation = gap.conceptExplanationSpoken;

    if (spokenExplanation) {
      if (hudToDisplay) {
        this.lastHudLatex = hudToDisplay;
        this.updatePinnedLiveHud(hudToDisplay, 0.4);
      }

      const explainTelemetry = {
        ...this.currentTelemetry,
        delib_state: 'COGNITIVE_STALL',
        hint_level: Math.min(4, (this.currentTelemetry.hint_level || 1) + 1)
      };
      this.currentTelemetry = explainTelemetry;
      this.updateTelemetryUI(this.currentTelemetry);

      const cleanHistoryEntry =
        (hudToDisplay ? `<hud>${hudToDisplay}</hud>\n` : '') +
        `<telemetry>${JSON.stringify(explainTelemetry)}</telemetry>\n` +
        spokenExplanation;
      this.conversationHistory.push({
        role: 'user',
        text: 'Yes, please explain the concept.'
      });
      this.conversationHistory.push({
        role: 'svs',
        text: cleanHistoryEntry
      });

      // Reset delibStage to 0 so the timer runs fresh for the follow-up step after the concept explanation is read
      this.delibStage = 0;
      this.hasActiveProblemTurn = true;

      this.appendChatMessage(
        'svs',
        spokenExplanation,
        `${profile.code} (${voiceName}) • Concept Gap Bridge (${gap.missingConcept})`,
        hudToDisplay
      );
      this.lastSpokenBurst = spokenExplanation;
      this.avionics.speakCalibratedBurst(spokenExplanation, this.activeProfileKey);

      // Immediately start analyzing the next potential learning gap behind the scenes while this explanation is read aloud
      this.analyzeLearningGapBehindTheScenes(spokenExplanation, hudToDisplay, 'Yes, please explain the concept.');
    }
  }

  /**
   * Runs asynchronously behind the scenes AS SOON AS the tutor starts reading the previous script aloud.
   * Diagnoses the hidden learning gap / prerequisite concept that could cause a student to stall at this step,
   * and pre-warms the TTS audio for both the Stage 2 offer and the concept explanation.
   */
  async analyzeLearningGapBehindTheScenes(tutorSpokenText, hudLatex, studentUtterance) {
    const fallbackGap = generateFallbackLearningGapAnalysis({
      lastHudLatex: hudLatex || this.lastHudLatex,
      lastTutorQuestion: tutorSpokenText || this.lastSpokenBurst,
      lastStudentMessage: studentUtterance || this.lastStudentUtterance
    });
    this.latestLearningGap = fallbackGap;

    try {
      const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
      const res = await fetch('/api/analyze-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: this.conversationHistory.slice(-6),
          lastTutorQuestion: tutorSpokenText || this.lastSpokenBurst,
          lastStudentMessage: studentUtterance || this.lastStudentUtterance,
          lastHudLatex: hudLatex || this.lastHudLatex,
          voiceName,
          apiKey: this.geminiApiKey || undefined
        })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.gapAnalysis && data.gapAnalysis.missingConcept) {
        this.latestLearningGap = data.gapAnalysis;
      }
    } catch {
      // Fallback gap analysis is already in place
    }
  }

  populateVoiceDropdown() {
    const select = document.getElementById('voiceSelectDropdown');
    if (!select) return;

    select.innerHTML = '<option value="">Auto (Match Tutor Style)</option>';
    NEURAL_HUMAN_VOICES.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `★ ${v.label}`;
      select.appendChild(opt);
    });

    this.updateActiveVoiceHint();
  }

  updateActiveVoiceHint() {
    const hint = document.getElementById('activeVoiceHint');
    if (!hint) return;
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const found = NEURAL_HUMAN_VOICES.find(v => v.id === voiceName);
    hint.textContent = `Studio Human Voice: ${found ? found.label : voiceName}`;
  }

  renderModePills() {
    const list = document.getElementById('modeSelectorList');
    list.innerHTML = '';

    Object.values(FLIGHT_MODES).forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mode-pill-btn ${mode.id === this.activeModeId ? 'active' : ''}`;
      btn.title = mode.objective;
      btn.textContent = mode.name;
      btn.addEventListener('click', () => this.selectMode(mode.id));
      list.appendChild(btn);
    });
  }

  selectMode(modeId) {
    const numId = Number(modeId);
    if (!FLIGHT_MODES[numId]) return;
    this.activeModeId = numId;
    this.avionics.activeMode = numId;
    this.renderModePills();
  }

  renderPersonaButtons() {
    const grid = document.getElementById('profileSelectorGrid');
    grid.innerHTML = '';

    Object.values(VOCAL_PROFILES).forEach((profile) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `persona-btn ${profile.id === this.activeProfileKey ? 'active' : ''}`;
      btn.innerHTML = `
        <strong>${profile.code}</strong>
        <span>${profile.subtitle}</span>
      `;
      btn.addEventListener('click', () => this.selectProfile(profile.id));
      grid.appendChild(btn);
    });
  }

  selectProfile(profileKey) {
    if (!VOCAL_PROFILES[profileKey]) return;
    this.activeProfileKey = profileKey;
    this.avionics.activeProfile = profileKey;
    this.renderPersonaButtons();
    this.updateActiveVoiceHint();
  }

  renderStarterChips() {
    const container = document.getElementById('scenarioChips');
    container.innerHTML = '';

    STEM_SCENARIOS.forEach((sc) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'scenario-chip';
      chip.textContent = `${sc.title} (${sc.course})`;
      chip.addEventListener('click', () => {
        if (sc.modeRecommendation !== this.activeModeId) {
          this.selectMode(sc.modeRecommendation);
        }
        this.processStudentTransmission(sc.prompt);
      });
      container.appendChild(chip);
    });
  }

  async processStudentTransmission(utterance) {
    const pauseSeconds = this.getElapsedDeliberationSeconds();
    this.stopScratchpadDeliberationClock();
    this.isTimerPaused = false;
    this.pausedElapsedSec = 0;
    const btnPause = document.getElementById('btnPauseTimer');
    if (btnPause) {
      btnPause.textContent = '⏸ Pause';
      btnPause.classList.remove('paused');
    }

    this.delibStage = 0;
    this.avionics.stopSpeaking('NEW_STUDENT_TURN');

    this.appendChatMessage('student', utterance);

    const consentIntent = detectManimConsentIntent(utterance);

    // 1. Check if we are waiting for Yes/No consent on the Stage 2 Concept Explanation Offer
    if (this.awaitingConceptConsent) {
      if (consentIntent === 'YES' || consentIntent === 'NO') {
        await this.handleConceptExplanationDecision(consentIntent);
        return;
      }
      if (/\b(explain|concept|help\s+me\s+understand|show\s+me\s+how)\b/i.test(utterance)) {
        await this.handleConceptExplanationDecision('YES');
        return;
      }
      this.awaitingConceptConsent = false;
    }

    // 2. Check if we are currently waiting for Yes/No consent for the End-of-Session solution video,
    // OR if the last tutor turn mentioned video/manim/animation/solution and the student replied Yes/No
    const lastTutorMentionedVideo = /\b(manim|video|animation|walkthrough|full\s+solution)\b/i.test(
      this.lastSpokenBurst || ''
    );

    if (this.awaitingManimConsent || lastTutorMentionedVideo) {
      if (consentIntent === 'YES' || consentIntent === 'NO') {
        await this.handleManimConsentDecision(consentIntent);
        return;
      }
      this.awaitingManimConsent = false;
    }

    // Also allow explicit voice/text request like "make a manim video", "show the video", "yes show video" at any time
    if (
      /\b(manim|instructional\s+video|solution\s+video)\b/i.test(utterance) ||
      /\b(make|create|show|play|watch|generate|see)\b[\s\S]*\b(video|animation)\b/i.test(utterance)
    ) {
      await this.handleManimConsentDecision('YES');
      return;
    }

    this.lastStudentUtterance = utterance;

    const retroactiveTelemetry = computeRetroactiveAttribution(
      utterance,
      pauseSeconds,
      this.currentTelemetry.step_tier,
      this.currentTelemetry.hint_level
    );

    const sysCmd = detectSystemCommand(utterance);
    if (sysCmd && sysCmd.type === 'MODE_SWITCH') {
      this.selectMode(sysCmd.mode);
      this.emitTriChannelResponse(sysCmd.response, { speak: true, fallbackTelemetry: retroactiveTelemetry });
      return;
    }

    const thinkingEl = this.appendThinkingBubble();

    try {
      const llmReply = await this.fetchServerGeminiChat(utterance, pauseSeconds);
      thinkingEl.remove();

      if (llmReply) {
        // Parse and sanitize BEFORE storing in history so raw `$` signs never pollute future turns!
        const parsedPacket = parseTriChannelPacket(llmReply, this.maxWords, retroactiveTelemetry);
        const cleanAssistantHistoryText =
          (parsedPacket.hudLatex ? `<hud>${parsedPacket.hudLatex}</hud>\n` : '') +
          (parsedPacket.graphSpec ? `<graph>${JSON.stringify(parsedPacket.graphSpec)}</graph>\n` : '') +
          `<telemetry>${JSON.stringify(parsedPacket.telemetry)}</telemetry>\n` +
          parsedPacket.spokenText;

        this.conversationHistory.push({ role: 'user', text: utterance });
        this.conversationHistory.push({ role: 'svs', text: cleanAssistantHistoryText });
        this.hasActiveProblemTurn = true;
        this.emitTriChannelResponse(llmReply, {
          speak: true,
          fallbackTelemetry: retroactiveTelemetry,
          studentUtterance: utterance
        });
        return;
      }
    } catch (err) {
      thinkingEl.remove();
      console.warn('Server chat fallback:', err);
    }

    this.hasActiveProblemTurn = true;
    const simResult = generateOfflineSocraticResponse(utterance, this.activeModeId, this.activeProfileKey);
    this.emitTriChannelResponse(simResult.text, {
      speak: true,
      fallbackTelemetry: retroactiveTelemetry,
      studentUtterance: utterance
    });
  }

  async fetchServerGeminiChat(utterance, pauseSeconds = 0) {
    const sysPrompt = buildSystemInstruction(this.activeProfileKey, this.activeModeId, this.maxWords);
    const tierObj = STEP_TIERS[this.currentTelemetry.step_tier] || STEP_TIERS[1];
    const modeObj = FLIGHT_MODES[this.activeModeId] || FLIGHT_MODES[1];

    const userTurnsSoFar = this.conversationHistory.filter(t => t.role === 'user').length;
    let diagnosticDirective = '';
    if (userTurnsSoFar === 0 && !isGraphRequestedByUser(utterance)) {
      diagnosticDirective = `[SECTION 15 COLD-START BASELINE CALIBRATION (Probe 1 of max 2 | ${modeObj.code} - ${modeObj.name}): Do NOT jump straight into calculation. Issue 1 low-stakes conceptual Micro-Diagnostic question (${modeObj.diagnosticFocus})]\n`;
    } else if (userTurnsSoFar === 1) {
      diagnosticDirective = `[SECTION 15 DIAGNOSTIC CHECK (Turn 2 of max 2 | ${modeObj.code} - ${modeObj.name}): If the student hesitated, guessed wrongly, or stalled on the diagnostic probe, IMMEDIATELY ABORT the diagnostic (Rule 4 Safety Net), give a 1-sentence foundational bridge, and ask Step 1 of the problem. If they answered the probe accurately, proceed directly into Step 1 of the problem (or at most 1 final diagnostic probe if essential).]\n`;
    } else if (userTurnsSoFar >= 2) {
      diagnosticDirective = `[SECTION 15 2-SHOT LIMIT REACHED: Diagnostic probing is complete. Guide the student through the active problem step-by-step (${modeObj.progressionRule}).]\n`;
    }

    const pauseContext =
      pauseSeconds >= 5
        ? `[Student Deliberation Pause: ${pauseSeconds.toFixed(1)}s | Previous Step Tier: ${tierObj.tier} (t_expected=${tierObj.expectedSec}s)]\n`
        : '';

    const gapContext =
      this.latestLearningGap && this.latestLearningGap.missingConcept
        ? `[BEHIND-THE-SCENES LEARNING GAP ANALYSIS: Missing Concept = "${this.latestLearningGap.missingConcept}" | Root Cause = "${this.latestLearningGap.whyStuck}" | Bridging Strategy = "${this.latestLearningGap.bridgingStrategy}". Relate directly to the student's response below and incorporate this learning-gap insight into your explanation!]\n`
        : '';

    const annotatedMessage = `${diagnosticDirective}${pauseContext}${gapContext}${utterance}`;
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: sysPrompt,
        history: this.conversationHistory,
        message: annotatedMessage,
        voiceName,
        apiKey: this.geminiApiKey || undefined
      })
    });

    if (!res.ok) {
      throw new Error(`Chat HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.reply || null;
  }

  appendThinkingBubble(customText = 'Thinking...') {
    const log = document.getElementById('commsLog');
    const row = document.createElement('div');
    row.className = 'chat-msg svs';
    row.innerHTML = `
      <div class="msg-avatar">✦</div>
      <div class="msg-bubble" style="color: var(--text-muted); font-style: italic;">
        ${customText}
      </div>
    `;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  emitTriChannelResponse(
    rawText,
    options = { speak: true, badge: '', fallbackTelemetry: null, studentUtterance: '' }
  ) {
    const t0 = performance.now();
    const packet = parseTriChannelPacket(rawText, this.maxWords, options.fallbackTelemetry);

    if (packet.hudLatex) {
      this.lastHudLatex = packet.hudLatex;
      this.updatePinnedLiveHud(packet.hudLatex, performance.now() - t0);
    }

    // Guarantee a visual graph if `<graph>` was emitted OR if the user asked for a graph
    let graphSpec = packet.graphSpec;
    if (!graphSpec && isGraphRequestedByUser(options.studentUtterance || this.lastStudentUtterance)) {
      graphSpec = buildFallbackGraphSpec(
        options.studentUtterance || this.lastStudentUtterance,
        packet.hudLatex || this.lastHudLatex
      );
    }
    if (graphSpec) {
      this.lastGraphSpec = graphSpec;
    }

    // Detect if this turn completes the explanation of a question ("a session")
    const spokenMentionsManim = /\b(manim|instructional\s+video|solution\s+video)\b/i.test(packet.spokenText || '');
    const isSessionComplete = Boolean(packet.telemetry.session_complete || spokenMentionsManim);

    this.currentTelemetry = packet.telemetry;
    this.updateTelemetryUI(this.currentTelemetry);

    if (isSessionComplete) {
      this.awaitingManimConsent = true;
      this.markQuestionSessionCompleted('Session Complete');
    }

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const mode = FLIGHT_MODES[this.activeModeId];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const tierLabel = `Tier ${packet.telemetry.step_tier} • ${packet.telemetry.delib_state}`;
    const footerTag = options.badge
      ? `${profile.code} (${voiceName}) • ${options.badge}`
      : `${profile.code} (${voiceName}) • ${mode.name} • ${tierLabel}`;

    this.appendChatMessage('svs', packet.spokenText, footerTag, packet.hudLatex, {
      graphSpec,
      tableSpec: packet.tableSpec,
      offerManim: isSessionComplete
    });

    if (packet.spokenText) {
      this.lastSpokenBurst = packet.spokenText;
      if (options.speak) {
        this.avionics.speakCalibratedBurst(packet.spokenText, this.activeProfileKey);
      } else if (this.hasActiveProblemTurn && this.autoScratchpadPing) {
        this.startScratchpadDeliberationClock();
      }

      // As soon as the script is being read by the chatbot, analyze the potential learning gap behind the scenes!
      if (this.hasActiveProblemTurn && !isSessionComplete) {
        this.analyzeLearningGapBehindTheScenes(
          packet.spokenText,
          packet.hudLatex || this.lastHudLatex,
          options.studentUtterance || this.lastStudentUtterance
        );
      }
    }
  }

  updateTelemetryUI(telemetry) {
    const tierObj = STEP_TIERS[telemetry.step_tier] || STEP_TIERS[1];

    const tierBadge = document.getElementById('stripTierBadge');
    if (tierBadge) {
      tierBadge.textContent = `TIER ${tierObj.tier} (${tierObj.expectedSec}s)`;
    }

    this.updateDelibBadgeUI(telemetry.delib_state);

    const timerEl = document.getElementById('stripScratchpadTimer');
    const fillEl = document.getElementById('stripScratchpadFill');
    if (timerEl) {
      timerEl.textContent = this.autoScratchpadPing
        ? `0.0s / ${tierObj.expectedSec}s`
        : `OFF (${tierObj.expectedSec}s)`;
    }
    if (fillEl) fillEl.style.width = '0%';

    const hintBadge = document.getElementById('stripHintBadge');
    if (hintBadge) {
      hintBadge.textContent = `${telemetry.hint_level} / 4`;
    }

    const setGauge = (valId, fillId, val) => {
      const vEl = document.getElementById(valId);
      const fEl = document.getElementById(fillId);
      if (vEl) vEl.textContent = String(val);
      if (fEl) fEl.style.width = `${val}%`;
    };

    setGauge('valIFlow', 'fillIFlow', telemetry.i_flow);
    setGauge('valIEff', 'fillIEff', telemetry.i_eff);
    setGauge('valIReg', 'fillIReg', telemetry.i_reg);
    setGauge('valCli', 'fillCli', telemetry.cli);

    const jsonBox = document.getElementById('telemetryJsonBox');
    if (jsonBox) {
      jsonBox.textContent = `<telemetry>${JSON.stringify(telemetry)}</telemetry>`;
    }
  }

  updateDelibBadgeUI(delibState) {
    const badge = document.getElementById('stripDelibBadge');
    if (!badge) return;
    badge.textContent = delibState;

    const classMap = {
      IMMEDIATE: 'delib-badge immediate',
      SCRATCHPAD_ACTIVE: 'delib-badge scratchpad',
      DEEP_DELIBERATION: 'delib-badge deep',
      COGNITIVE_STALL: 'delib-badge stall'
    };
    badge.className = classMap[delibState] || 'delib-badge immediate';
  }

  updatePinnedLiveHud(latexStr, elapsedMs) {
    const banner = document.getElementById('liveHudBanner');
    const eqContainer = document.getElementById('liveHudEquation');
    const latencyTag = document.getElementById('hudRenderLatency');
    if (!banner || !eqContainer) return;

    banner.hidden = false;
    this.renderLatexElement(eqContainer, latexStr);

    if (latencyTag) {
      latencyTag.textContent = `${Math.max(0.2, elapsedMs).toFixed(1)} ms`;
    }
  }

  /**
   * Passes any math string through `sanitizeLatexForHud` BEFORE calling KaTeX
   * so `$` or `$$` delimiters never cause a KaTeX error or render raw `$` signs.
   */
  renderLatexElement(targetEl, rawLatexStr) {
    const screenedLatex = sanitizeLatexForHud(rawLatexStr);
    if (!screenedLatex) {
      targetEl.textContent = '';
      return;
    }

    if (window.katex) {
      try {
        window.katex.render(screenedLatex, targetEl, {
          displayMode: false,
          throwOnError: false
        });
        return;
      } catch (err) {
        console.warn('KaTeX render fallback:', err);
      }
    }
    targetEl.textContent = screenedLatex;
  }

  appendChatMessage(role, spokenText, footerText = '', hudLatex = '', attachments = {}) {
    const log = document.getElementById('commsLog');
    const row = document.createElement('div');
    row.className = `chat-msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'student' ? '👤' : '✦';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (role === 'svs' && hudLatex) {
      const screened = sanitizeLatexForHud(hudLatex);
      if (screened) {
        const hudCard = document.createElement('div');
        hudCard.className = 'hud-math-card';

        const mathBody = document.createElement('div');
        this.renderLatexElement(mathBody, screened);
        hudCard.appendChild(mathBody);

        bubble.appendChild(hudCard);
      }
    }

    // Screen spokenText so no stray `$` signs ever appear in chat text
    const cleanVisibleText = String(spokenText || '').replace(/\$/g, '').trim();
    const p = document.createElement('div');
    p.textContent = cleanVisibleText;
    bubble.appendChild(p);

    // 0. Structured Problem-Solving / Reference Table inside the chat bubble
    if (
      role === 'svs' &&
      attachments.tableSpec &&
      Array.isArray(attachments.tableSpec.headers) &&
      Array.isArray(attachments.tableSpec.rows)
    ) {
      const tableEl = document.createElement('table');
      tableEl.className = 'stem-info-table';
      const thead = document.createElement('thead');
      const hRow = document.createElement('tr');
      attachments.tableSpec.headers.forEach((h) => {
        const th = document.createElement('th');
        th.textContent = String(h).replace(/\$/g, '');
        hRow.appendChild(th);
      });
      thead.appendChild(hRow);
      tableEl.appendChild(thead);

      const tbody = document.createElement('tbody');
      attachments.tableSpec.rows.forEach((r) => {
        if (!Array.isArray(r)) return;
        const tr = document.createElement('tr');
        r.forEach((cell) => {
          const td = document.createElement('td');
          td.textContent = String(cell).replace(/\$/g, '');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      tableEl.appendChild(tbody);
      bubble.appendChild(tableEl);
    }

    // 1. Interactive Graphing Calculator Card inside the chat bubble
    if (role === 'svs' && attachments.graphSpec) {
      const graphWidget = createInteractiveGraphElement(attachments.graphSpec);
      bubble.appendChild(graphWidget);
    }

    // 1.5 Stage 2 Concept Explanation Offer Card (when second 15s timer expires)
    if (role === 'svs' && attachments.offerConcept) {
      const conceptCard = document.createElement('div');
      conceptCard.className = 'manim-offer-card';

      const gapTitle = attachments.missingConcept || this.latestLearningGap?.missingConcept || 'Core Prerequisite Concept';
      conceptCard.innerHTML = `
        <div class="manim-offer-title">💡 Concept Explanation Available: ${gapTitle}</div>
        <div class="manim-offer-desc">
          Would you like me to explain the underlying concept behind this step so we can bridge the gap together?
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'manim-offer-actions';

      const yesBtn = document.createElement('button');
      yesBtn.type = 'button';
      yesBtn.className = 'manim-yes-btn';
      yesBtn.textContent = '💡 Yes, Explain the Concept';

      const noBtn = document.createElement('button');
      noBtn.type = 'button';
      noBtn.className = 'manim-no-btn';
      noBtn.textContent = '✋ I Will Keep Trying';

      yesBtn.addEventListener('click', () => {
        yesBtn.disabled = true;
        noBtn.disabled = true;
        this.handleConceptExplanationDecision('YES');
      });

      noBtn.addEventListener('click', () => {
        yesBtn.disabled = true;
        noBtn.disabled = true;
        this.handleConceptExplanationDecision('NO');
      });

      actions.appendChild(yesBtn);
      actions.appendChild(noBtn);
      conceptCard.appendChild(actions);
      bubble.appendChild(conceptCard);
    }

    // 2. End-of-Session Step-by-Step Solution Video Consent Offer Card
    if (role === 'svs' && attachments.offerManim) {
      const offerCard = document.createElement('div');
      offerCard.className = 'manim-offer-card';

      const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
      offerCard.innerHTML = `
        <div class="manim-offer-title">🎬 Step-by-Step Solution Video</div>
        <div class="manim-offer-desc">
          Would you like to watch a full step-by-step animated solution with voice explanation (narrated by <strong>${voiceName}</strong>) for this question?
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'manim-offer-actions';

      const yesBtn = document.createElement('button');
      yesBtn.type = 'button';
      yesBtn.className = 'manim-yes-btn';
      yesBtn.textContent = '▶ Yes, Watch Solution Video';

      const noBtn = document.createElement('button');
      noBtn.type = 'button';
      noBtn.className = 'manim-no-btn';
      noBtn.textContent = '✕ No Thanks';

      yesBtn.addEventListener('click', () => {
        yesBtn.disabled = true;
        noBtn.disabled = true;
        this.handleManimConsentDecision('YES');
      });

      noBtn.addEventListener('click', () => {
        yesBtn.disabled = true;
        noBtn.disabled = true;
        this.handleManimConsentDecision('NO');
      });

      actions.appendChild(yesBtn);
      actions.appendChild(noBtn);
      offerCard.appendChild(actions);
      bubble.appendChild(offerCard);
    }

    // 3. Embedded Manim `<canvas>` Video Player Element
    if (role === 'svs' && attachments.manimStoryboard) {
      if (this.activeManimController) {
        this.activeManimController.stop();
      }
      const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
      const playbackRate = Math.max(
        0.75,
        Math.min(1.5, this.avionics.customRateMultiplier || 1.1)
      );

      const manimWidget = createManimVideoElement(attachments.manimStoryboard, {
        voiceName,
        playbackRate,
        getPlaybackRate: () => this.avionics.customRateMultiplier || 1.1,
        apiKey: this.geminiApiKey,
        onPlaybackStateChange: (playing) => {
          this.avionics.setBotSpeakingState(playing);
        },
        onVideoComplete: (completedStoryboard) => {
          this.handleSolutionVideoCompleted(completedStoryboard);
        }
      });

      const manimEl = manimWidget?.element || manimWidget;
      this.activeManimController = manimWidget?.controller || manimEl?.controller || null;
      if (manimEl instanceof HTMLElement) {
        bubble.appendChild(manimEl);
      }
    }

    if (role === 'svs') {
      const footer = document.createElement('div');
      footer.className = 'msg-footer';

      const metaSpan = document.createElement('span');
      metaSpan.textContent = footerText;
      footer.appendChild(metaSpan);

      const replayBtn = document.createElement('button');
      replayBtn.type = 'button';
      replayBtn.className = 'speak-again-btn';
      replayBtn.textContent = '🔊 Listen';
      replayBtn.addEventListener('click', () => {
        this.avionics.speakCalibratedBurst(cleanVisibleText, this.activeProfileKey);
      });
      footer.appendChild(replayBtn);

      if (!attachments.manimStoryboard && this.hasActiveProblemTurn) {
        const manimQuickBtn = document.createElement('button');
        manimQuickBtn.type = 'button';
        manimQuickBtn.className = 'speak-again-btn';
        manimQuickBtn.textContent = '🎬 Solution Video';
        manimQuickBtn.title = 'Watch a full step-by-step visual solution video with voice explanation';
        manimQuickBtn.addEventListener('click', () => {
          this.handleManimConsentDecision('YES');
        });
        footer.appendChild(manimQuickBtn);
      }

      bubble.appendChild(footer);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  handleVadUpdate(vad) {
    this.isUserSpeaking = vad.isSpeaking;
    this.isMutedForEcho = Boolean(vad.isMutedForEcho);
    this.updateMicStatusUI();
  }

  updateMicStatusUI() {
    const btnToggleMic = document.getElementById('btnToggleMic');
    const micBtnLabel = document.getElementById('micBtnLabel');
    const statusDot = document.getElementById('statusDot');
    const vadStateTag = document.getElementById('vadStateTag');

    if (!this.avionics.isMicActive) {
      btnToggleMic.className = 'mic-pill-btn';
      micBtnLabel.textContent = 'Speak';
      statusDot.className = 'status-dot';
      vadStateTag.textContent = this.isBotSpeaking
        ? 'Tutor speaking...'
        : 'Mic off — click Speak to talk with the tutor';
      return;
    }

    if (this.isBotSpeaking || this.isMutedForEcho) {
      btnToggleMic.className = 'mic-pill-btn echo-paused';
      micBtnLabel.textContent = 'Mic Paused';
      statusDot.className = 'status-dot muted-echo';
      vadStateTag.textContent = 'Tutor speaking — microphone auto-muted so it will not hear the speaker';
    } else {
      btnToggleMic.className = 'mic-pill-btn active';
      micBtnLabel.textContent = 'Listening';
      statusDot.className = 'status-dot listening';
      vadStateTag.textContent = this.isUserSpeaking
        ? 'Hearing you speak — smart pause detector active...'
        : 'Listening for your voice (2.4s smart pause detector + mid-sentence grace)...';
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.svsApp = new SocraticGeminiChatApp();
});
