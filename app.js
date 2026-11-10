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
  extractVisualQuestionFromSpoken,
  inferElementaryDiagramIfHelpful,
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
  analyzeStudentResponseAndEngagement,
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

    // Section 16: Active Topic Anchor, Clue-Gathering & Engagement State
    this.activeTopicAnchor = '';
    this.uncertaintyStreak = 0;
    this.lastTurnAskedForClue = false;
    this.gapAbortController = null;

    // Left-Side HUD Canvas Step Progression & Auto-Refresh State
    this.hudSteps = [];
    this.hudShouldRefreshOnNextQuestion = false;

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
    this.resetHudCanvasUI('Ready for Question');

    this.appendChatMessage(
      'svs',
      'Hi! I am your Ontario STEM tutor (Grades 6–12) with a visual Left HUD Canvas for step progression & diagrams, interactive graphing, and step-by-step solution videos. Pick a starter problem below or ask any math or science question.',
      `${VOCAL_PROFILES[this.activeProfileKey].code} • ${FLIGHT_MODES[this.activeModeId].name}`,
      ''
    );
  }

  initUI() {
    this.renderModePills();
    this.renderPersonaButtons();
    this.renderStarterChips();
    this.populateVoiceDropdown();

    const btnResetHudCanvas = document.getElementById('btnResetHudCanvas');
    if (btnResetHudCanvas) {
      btnResetHudCanvas.addEventListener('click', () => {
        this.resetHudCanvasUI('HUD Canvas Refreshed');
      });
    }

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
      if (this.gapAbortController) {
        try {
          this.gapAbortController.abort();
        } catch (_) {}
        this.gapAbortController = null;
      }
      this.conversationHistory = [];
      this.stopScratchpadDeliberationClock();
      this.hasActiveProblemTurn = false;
      this.delibStage = 0;
      this.activeTopicAnchor = '';
      this.uncertaintyStreak = 0;
      this.lastTurnAskedForClue = false;
      this.awaitingManimConsent = false;
      this.awaitingConceptConsent = false;
      this.latestLearningGap = null;
      this.lastHudLatex = '';
      this.lastGraphSpec = null;
      this.currentTelemetry = { ...DEFAULT_TELEMETRY };
      this.updateTelemetryUI(this.currentTelemetry);
      this.resetHudCanvasUI('Fresh Study Session');
      document.getElementById('commsLog').innerHTML = '';
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
    this.activeTopicAnchor = '';
    this.uncertaintyStreak = 0;
    this.lastTurnAskedForClue = false;

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
   * Explicitly ends the current question session, refreshes the Left HUD Canvas for the next question,
   * and asks the user if they want a step-by-step solution video.
   */
  offerEndOfSessionManimVideo() {
    this.markQuestionSessionCompleted('Session Complete');
    this.awaitingManimConsent = true;
    const spoken =
      'Great work completing this problem! Would you like to watch a full step-by-step solution video with voice explanation for the question we just solved?';
    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    // Refresh the Left HUD Canvas now that one question is finished (signaled by offering the solution video)
    this.refreshHudCanvasOnQuestionComplete(spoken);

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
          graphExpr: '',
          highlightPoint: null
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
          graphExpr: '',
          highlightPoint: null
        },
        {
          heading: 'Step 3: Splitting the Linear Term & Grouping',
          conceptTag: 'Rewrite 5x as 4x + x and factor each pair',
          latex: '2x^2 + 4x + x + 2 = 0 \\implies 2x(x + 2) + 1(x + 2) = 0',
          annotation: 'Shared binomial factor (x + 2) appears in both grouped terms.',
          narration: 'Next, we rewrite the middle term five x as four x plus one x. Factoring by grouping extracts two x from the first pair and positive one from the second pair, revealing the shared binomial factor x plus two.',
          graphExpr: '',
          highlightPoint: null
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

    // Prepare Stage 2 concept explanation in the background only when Stage 1 timer has actually fired
    this.analyzeLearningGapBehindTheScenes(
      this.lastSpokenBurst,
      this.lastHudLatex,
      this.lastStudentUtterance,
      true
    );
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
        this.updateLeftHudCanvas({
          topicText: this.activeTopicAnchor || this.lastStudentUtterance,
          hudLatex: hudToDisplay,
          questionText: extractVisualQuestionFromSpoken(spokenExplanation),
          diagramSpec: inferElementaryDiagramIfHelpful(
            this.lastStudentUtterance,
            hudToDisplay,
            spokenExplanation,
            this.activeTopicAnchor
          ),
          elapsedMs: 0.4,
          stepLabel: `Concept Bridge: ${gap.missingConcept}`
        });
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
   * Computes an instant 0ms local fallback concept-bridge on normal turns (preventing multi-turn network/CPU lag)
   * and only queries `/api/analyze-gap` when the student reaches Stage 1 deliberation (15s silence) for Stage 2 offer.
   */
  async analyzeLearningGapBehindTheScenes(tutorSpokenText, hudLatex, studentUtterance, fetchFromServer = false) {
    const fallbackGap = generateFallbackLearningGapAnalysis({
      lastHudLatex: hudLatex || this.lastHudLatex,
      lastTutorQuestion: tutorSpokenText || this.lastSpokenBurst,
      lastStudentMessage: studentUtterance || this.lastStudentUtterance
    });
    this.latestLearningGap = fallbackGap;

    if (!fetchFromServer) return;

    if (this.gapAbortController) {
      try {
        this.gapAbortController.abort();
      } catch (_) {}
    }
    this.gapAbortController = new AbortController();

    try {
      const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
      const res = await fetch('/api/analyze-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.gapAbortController.signal,
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
    if (this.gapAbortController) {
      try {
        this.gapAbortController.abort();
      } catch (_) {}
      this.gapAbortController = null;
    }
    this.avionics.stopSpeaking('NEW_STUDENT_TURN');
    // Immediately engage echo lock while the tutor generates and begins speaking its explanation
    this.avionics.engageSpeakerEchoLock();

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

    // If the previous question finished and refreshed the HUD Canvas, ensure step history is clean for the new question
    if (this.hudShouldRefreshOnNextQuestion) {
      this.hudSteps = [];
      this.hudShouldRefreshOnNextQuestion = false;
    }

    // Anchor the main topic on the first question of a session (never overwrite on "I don't know" or short replies)
    if (!this.activeTopicAnchor && utterance.trim().length > 3) {
      this.activeTopicAnchor = utterance.trim();
    }

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
      const chatResult = await this.fetchServerGeminiChat(utterance, pauseSeconds);
      thinkingEl.remove();

      if (chatResult && chatResult.reply) {
        const llmReply = chatResult.reply;
        // Parse and store a compact history entry (omitting bulky <graph> and <telemetry> JSON so long conversations stay fast)
        const parsedPacket = parseTriChannelPacket(llmReply, this.maxWords, retroactiveTelemetry);
        const cleanAssistantHistoryText =
          (parsedPacket.hudLatex ? `<hud>${parsedPacket.hudLatex}</hud>\n` : '') +
          parsedPacket.spokenText;

        this.conversationHistory.push({ role: 'user', text: utterance });
        this.conversationHistory.push({ role: 'svs', text: cleanAssistantHistoryText });
        // Bound in-memory history array so elongated conversations never accumulate unbounded payload bloat
        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-12);
        }

        this.hasActiveProblemTurn = true;
        this.emitTriChannelResponse(llmReply, {
          speak: true,
          fallbackTelemetry: retroactiveTelemetry,
          studentUtterance: utterance,
          prewarmedAudio: {
            audioChunks: chatResult.audioChunks,
            firstChunkWavBase64: chatResult.firstChunkWavBase64
          }
        });
        return;
      }
    } catch (err) {
      thinkingEl.remove();
      console.warn('Server chat fallback:', err);
    }

    this.hasActiveProblemTurn = true;
    const simResult = generateOfflineSocraticResponse(utterance, this.activeModeId, this.activeProfileKey, {
      activeTopicAnchor: this.activeTopicAnchor,
      lastHudLatex: this.lastHudLatex,
      uncertaintyStreak: this.uncertaintyStreak,
      lastTurnAskedForClue: this.lastTurnAskedForClue
    });
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
    const engagement = analyzeStudentResponseAndEngagement(utterance, {
      activeTopicAnchor: this.activeTopicAnchor || utterance,
      uncertaintyStreak: this.uncertaintyStreak,
      lastTurnAskedForClue: this.lastTurnAskedForClue
    });

    this.uncertaintyStreak = engagement.nextUncertaintyStreak;
    this.lastTurnAskedForClue = engagement.nextAskedForClue;

    let diagnosticDirective = '';
    if (userTurnsSoFar === 0 && !isGraphRequestedByUser(utterance)) {
      diagnosticDirective = `[SECTION 15 COLD-START BASELINE CALIBRATION (Probe 1 of max 2 | ${modeObj.code} - ${modeObj.name}): Do NOT jump straight into calculation. Issue 1 low-stakes conceptual Micro-Diagnostic question (${modeObj.diagnosticFocus})]\n`;
    } else if (userTurnsSoFar === 1 && !engagement.isUncertainOrHintRequest) {
      diagnosticDirective = `[SECTION 15 DIAGNOSTIC CHECK (Turn 2 of max 2 | ${modeObj.code} - ${modeObj.name}): If the student hesitated, guessed wrongly, or stalled on the diagnostic probe, IMMEDIATELY ABORT the diagnostic (Rule 4 Safety Net), give a 1-sentence foundational bridge, and ask Step 1 of the problem. If they answered the probe accurately, proceed directly into Step 1 of the problem.]\n`;
    } else if (userTurnsSoFar >= 2 && !engagement.isUncertainOrHintRequest) {
      diagnosticDirective = `[SECTION 15 2-SHOT LIMIT REACHED: Guide the student through the active problem step-by-step (${modeObj.progressionRule}) from the fundamental ground up.]\n`;
    }

    const topicAnchorHeader = this.activeTopicAnchor
      ? `[MAIN TOPIC ANCHOR: "${this.activeTopicAnchor}" — Stay 100% anchored to this exact topic and scenario. NEVER stray into unrelated examples or equations.]\n`
      : '';

    const pauseContext =
      pauseSeconds >= 5
        ? `[Student Deliberation Pause: ${pauseSeconds.toFixed(1)}s | Previous Step Tier: ${tierObj.tier} (t_expected=${tierObj.expectedSec}s)]\n`
        : '';

    const annotatedMessage = `${topicAnchorHeader}${diagnosticDirective}${engagement.directive}\n${pauseContext}${utterance}`;
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    // Send only the 8 most recent compact turns so multi-turn response latency never increases
    const recentHistory = this.conversationHistory.slice(-8);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: sysPrompt,
        history: recentHistory,
        message: annotatedMessage,
        voiceName,
        maxWords: this.maxWords,
        apiKey: this.geminiApiKey || undefined
      })
    });

    if (!res.ok) {
      throw new Error(`Chat HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !data.reply) return null;
    return {
      reply: data.reply,
      audioChunks: data.audioChunks || [],
      firstChunkWavBase64: data.firstChunkWavBase64 || null
    };
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
    const packet = parseTriChannelPacket(
      rawText,
      this.maxWords,
      options.fallbackTelemetry,
      this.activeTopicAnchor || options.studentUtterance || this.lastStudentUtterance
    );

    if (packet.hudLatex) {
      this.lastHudLatex = packet.hudLatex;
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

    // Detect if this turn completes the explanation of a question ("a session", signaled by offering the solution video)
    const spokenMentionsManim = /\b(manim|instructional\s+video|solution\s+video)\b/i.test(packet.spokenText || '');
    const isSessionComplete = Boolean(packet.telemetry.session_complete || spokenMentionsManim);

    this.currentTelemetry = packet.telemetry;
    this.updateTelemetryUI(this.currentTelemetry);

    if (isSessionComplete) {
      this.awaitingManimConsent = true;
      this.markQuestionSessionCompleted('Session Complete');
      // Refresh the Left HUD Canvas automatically after one question is finished!
      this.refreshHudCanvasOnQuestionComplete(packet.spokenText);
    } else {
      // Determine if an elementary / conceptual visual aid diagram is helpful for this step
      const diagramSpec =
        packet.diagramSpec ||
        inferElementaryDiagramIfHelpful(
          options.studentUtterance || this.lastStudentUtterance,
          packet.hudLatex || this.lastHudLatex,
          packet.spokenText,
          this.activeTopicAnchor
        );

      this.updateLeftHudCanvas({
        topicText:
          this.activeTopicAnchor ||
          options.studentUtterance ||
          this.lastStudentUtterance ||
          'Active STEM Problem',
        hudLatex: packet.hudLatex || this.lastHudLatex,
        questionText: packet.hudQuestionText || extractVisualQuestionFromSpoken(packet.spokenText),
        diagramSpec,
        elapsedMs: performance.now() - t0
      });
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
        this.avionics.speakCalibratedBurst(
          packet.spokenText,
          this.activeProfileKey,
          options.prewarmedAudio || null
        );
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
      latencyTag.textContent = `${Math.max(0.2, elapsedMs || 0.2).toFixed(1)} ms`;
    }
  }

  /**
   * Resets the Left-Side HUD Canvas Panel to a clean state
   */
  resetHudCanvasUI(statusText = 'Ready for Next Question') {
    this.hudSteps = [];
    this.hudShouldRefreshOnNextQuestion = false;

    const statusBadge = document.getElementById('hudSessionStatusBadge');
    const topicTitle = document.getElementById('hudTopicTitle');
    const qText = document.getElementById('hudCurrentQuestionText');
    const diagSection = document.getElementById('hudDiagramSection');

    if (statusBadge) statusBadge.textContent = statusText;
    if (topicTitle) {
      topicTitle.textContent = 'Select a starter problem or ask any Grade 6–12 STEM question to begin.';
    }
    this.updatePinnedLiveHud('\\text{Ready: Ask any math or science question!}', 0.2);
    if (qText) {
      qText.textContent = 'What math or science question would you like to explore today?';
    }
    if (diagSection) {
      diagSection.hidden = true;
    }
    this.renderHudStepProgression();
  }

  /**
   * Automatically refreshes the Left-Side HUD Canvas when one question is finished
   * (signaled by asking whether the user wants the step-by-step solution video).
   */
  refreshHudCanvasOnQuestionComplete(videoOfferPrompt = '') {
    this.hudSteps = [];
    this.hudShouldRefreshOnNextQuestion = true;

    const statusBadge = document.getElementById('hudSessionStatusBadge');
    const topicTitle = document.getElementById('hudTopicTitle');
    const qText = document.getElementById('hudCurrentQuestionText');
    const diagSection = document.getElementById('hudDiagramSection');

    if (statusBadge) {
      statusBadge.textContent = 'Question Complete • HUD Refreshed';
    }
    if (topicTitle) {
      topicTitle.textContent = 'Question finished! HUD Canvas refreshed and ready for your next question.';
    }
    this.updatePinnedLiveHud(
      '\\text{Question Complete } \\checkmark \\quad (\\text{Ready for Next Question})',
      0.2
    );
    if (qText) {
      qText.textContent =
        extractVisualQuestionFromSpoken(videoOfferPrompt) ||
        'Would you like to watch the step-by-step solution video, or start a new question?';
    }
    if (diagSection) {
      diagSection.hidden = true;
    }
    this.renderHudStepProgression();
  }

  /**
   * Updates the Left-Side HUD Canvas with:
   *  1. The explicit active problem/topic,
   *  2. The current step's `<hud>` equation/example,
   *  3. The exact question currently being asked visually,
   *  4. The optional Elementary / Concept Visual Aid Diagram (only when needed), and
   *  5. The step-by-step progression list for the current question.
   */
  updateLeftHudCanvas({
    topicText = '',
    hudLatex = '',
    questionText = '',
    diagramSpec = null,
    elapsedMs = 0.2,
    stepLabel = ''
  } = {}) {
    const statusBadge = document.getElementById('hudSessionStatusBadge');
    const topicTitle = document.getElementById('hudTopicTitle');
    const qText = document.getElementById('hudCurrentQuestionText');
    const diagSection = document.getElementById('hudDiagramSection');
    const diagTitle = document.getElementById('hudDiagramTitle');
    const diagCanvas = document.getElementById('hudDiagramCanvas');
    const diagCaption = document.getElementById('hudDiagramCaption');

    if (statusBadge) {
      statusBadge.textContent = `Active Problem • Step ${this.hudSteps.length + 1}`;
    }

    const cleanTopic = String(topicText || this.activeTopicAnchor || 'Active STEM Problem')
      .replace(/\$/g, '')
      .trim();
    if (topicTitle && cleanTopic) {
      topicTitle.textContent = `Main Problem: ${cleanTopic}`;
    }

    const effectiveLatex =
      sanitizeLatexForHud(hudLatex) ||
      '\\text{Problem: } ' + cleanTopic.replace(/[\\{}]/g, '').slice(0, 50);
    this.updatePinnedLiveHud(effectiveLatex, elapsedMs);

    const cleanQuestion = String(
      questionText || 'What do you think our next step is?'
    )
      .replace(/\$/g, '')
      .trim();
    if (qText) {
      qText.textContent = cleanQuestion;
    }

    // Show Visual Aid Diagram ONLY when necessary and deemed to improve student's understanding
    if (diagramSpec && diagSection && diagCanvas) {
      diagSection.hidden = false;
      if (diagTitle) {
        diagTitle.textContent = diagramSpec.title || 'Visual Concept Aid';
      }
      if (diagCaption) {
        diagCaption.textContent = diagramSpec.caption || '';
      }
      this.renderVisualAidDiagram(diagCanvas, diagramSpec);
    } else if (diagSection) {
      diagSection.hidden = true;
    }

    // Append or update the step progression entry for the current question
    const lastStep = this.hudSteps[this.hudSteps.length - 1];
    if (
      !lastStep ||
      lastStep.hudLatex !== effectiveLatex ||
      lastStep.questionText !== cleanQuestion
    ) {
      this.hudSteps.push({
        stepNumber: this.hudSteps.length + 1,
        label: stepLabel || `Step ${this.hudSteps.length + 1}`,
        hudLatex: effectiveLatex,
        questionText: cleanQuestion
      });
      if (this.hudSteps.length > 10) {
        this.hudSteps = this.hudSteps.slice(-10);
      }
    }

    if (statusBadge) {
      statusBadge.textContent = `Active Problem • Step ${this.hudSteps.length}`;
    }
    this.renderHudStepProgression();
  }

  /**
   * Renders the chronological step progression cards inside `#hudStepProgressionList`
   */
  renderHudStepProgression() {
    const listEl = document.getElementById('hudStepProgressionList');
    const countBadge = document.getElementById('hudStepCountBadge');
    if (!listEl) return;

    if (countBadge) {
      countBadge.textContent = `${this.hudSteps.length} ${this.hudSteps.length === 1 ? 'Step' : 'Steps'}`;
    }

    listEl.innerHTML = '';
    if (this.hudSteps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hud-step-empty';
      empty.textContent = this.hudShouldRefreshOnNextQuestion
        ? 'Question complete! The step progression canvas is refreshed and ready for your next question.'
        : 'Each step of our current question will appear here in order as we build the solution together.';
      listEl.appendChild(empty);
      return;
    }

    this.hudSteps.forEach((step, idx) => {
      const isLatest = idx === this.hudSteps.length - 1;
      const item = document.createElement('div');
      item.className = `hud-step-item ${isLatest ? 'active-step' : ''}`;

      const head = document.createElement('div');
      head.className = 'hud-step-item-head';
      head.innerHTML = `<span>${step.label || `Step ${idx + 1}`}</span><span>${
        isLatest ? '● Current Step' : '✓'
      }</span>`;
      item.appendChild(head);

      if (step.hudLatex) {
        const mathDiv = document.createElement('div');
        mathDiv.className = 'hud-step-item-math';
        this.renderLatexElement(mathDiv, step.hudLatex);
        item.appendChild(mathDiv);
      }

      if (step.questionText) {
        const qDiv = document.createElement('div');
        qDiv.className = 'hud-step-item-question';
        qDiv.textContent = step.questionText;
        item.appendChild(qDiv);
      }

      listEl.appendChild(item);
    });

    listEl.scrollTop = listEl.scrollHeight;
  }

  /**
   * Renders crisp Elementary (Grade 6–8) & Conceptual Visual Aid Diagrams on `#hudDiagramCanvas`:
   * Supports `fraction_bar`, `balance_scale`, `number_line`, `ratio_bars`, and `area_model`.
   */
  renderVisualAidDiagram(canvas, spec = {}) {
    if (!canvas || !spec) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width || 760;
    const H = canvas.height || 300;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#11141c';
    ctx.fillRect(0, 0, W, H);

    const type = String(spec.type || 'fraction_bar').toLowerCase();

    if (type === 'fraction_bar') {
      const num = Math.max(0, Number(spec.numerator) || 32);
      const den = Math.max(1, Number(spec.denominator) || 64);
      const ratio = Math.max(0, Math.min(1, num / den));
      const segments = den <= 16 ? den : den === 64 ? 8 : 8;

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 20px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${num} out of ${den} (${spec.unitLabel || `1 Whole = ${den} Parts`})`,
        W / 2,
        46
      );

      const barX = 68;
      const barY = 82;
      const barW = W - 136;
      const barH = 74;

      // Empty bar track
      ctx.fillStyle = '#1e2536';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 10);
      ctx.fill();
      ctx.stroke();

      // Filled portion
      const fillW = Math.round(barW * ratio);
      if (fillW > 0) {
        const grad = ctx.createLinearGradient(barX, barY, barX + fillW, barY);
        grad.addColorStop(0, '#4f9cf9');
        grad.addColorStop(1, '#34d399');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(barX, barY, fillW, barH, 10);
        ctx.fill();
      }

      // Segment grid dividers
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < segments; i++) {
        const sx = barX + (barW * i) / segments;
        ctx.beginPath();
        ctx.moveTo(sx, barY);
        ctx.lineTo(sx, barY + barH);
        ctx.stroke();
      }

      // Labels below bar
      ctx.fillStyle = '#81c995';
      ctx.font = 'bold 18px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Filled Part (Top Number): ${num}`, barX, barY + barH + 38);

      ctx.fillStyle = '#a8c7fa';
      ctx.textAlign = 'right';
      ctx.fillText(`Whole Slot (Bottom Number): ${den}`, barX + barW, barY + barH + 38);

      // Simplified fraction badge
      const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
      const g = gcd(num, den);
      const simpNum = num / g;
      const simpDen = den / g;
      ctx.fillStyle = '#fdd663';
      ctx.font = 'bold 19px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        g > 1
          ? `Fraction: ${num}/${den}  =  ${simpNum}/${simpDen} of 1 full slot`
          : `Fraction: ${num}/${den}`,
        W / 2,
        barY + barH + 84
      );
      return;
    }

    if (type === 'balance_scale') {
      const leftText = String(spec.left || '2x + 4');
      const rightText = String(spec.right || '10');

      // Fulcrum base
      const cx = W / 2;
      const beamY = 148;
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.moveTo(cx, beamY);
      ctx.lineTo(cx - 42, 245);
      ctx.lineTo(cx + 42, 245);
      ctx.closePath();
      ctx.fill();

      // Horizontal balance beam
      ctx.strokeStyle = '#fdd663';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(150, beamY);
      ctx.lineTo(W - 150, beamY);
      ctx.stroke();

      // Equals sign on fulcrum
      ctx.fillStyle = '#fdd663';
      ctx.font = 'bold 26px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('=', cx, beamY - 18);

      // Left pan & box
      const drawPan = (px, label, color) => {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 85, beamY - 8);
        ctx.lineTo(px + 85, beamY - 8);
        ctx.stroke();

        ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(px - 78, beamY - 76, 156, 62, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, px, beamY - 37);
      };

      drawPan(210, leftText, '#a8c7fa');
      drawPan(W - 210, rightText, '#81c995');

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 17px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Both pans weigh the same — do the same operation to both sides!',
        cx,
        276
      );
      return;
    }

    if (type === 'number_line') {
      const min = Number.isFinite(Number(spec.min)) ? Number(spec.min) : -5;
      const max = Number.isFinite(Number(spec.max)) ? Number(spec.max) : 5;
      const start = Number.isFinite(Number(spec.start)) ? Number(spec.start) : -2;
      const end = Number.isFinite(Number(spec.end)) ? Number(spec.end) : 3;

      const lineY = 175;
      const padX = 72;
      const lineW = W - padX * 2;
      const toX = (v) => padX + ((v - min) / Math.max(1, max - min)) * lineW;

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(padX - 18, lineY);
      ctx.lineTo(W - padX + 18, lineY);
      ctx.stroke();

      for (let v = min; v <= max; v++) {
        const x = toX(v);
        ctx.strokeStyle = v === 0 ? '#fdd663' : '#94a3b8';
        ctx.lineWidth = v === 0 ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(x, lineY - 10);
        ctx.lineTo(x, lineY + 10);
        ctx.stroke();

        ctx.fillStyle = v === 0 ? '#fdd663' : '#e2e8f0';
        ctx.font = v === 0 ? 'bold 17px Inter, sans-serif' : '16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(v), x, lineY + 34);
      }

      // Jump arc from start to end
      const sx = toX(start);
      const ex = toX(end);
      ctx.strokeStyle = '#4f9cf9';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, lineY - 12);
      ctx.quadraticCurveTo((sx + ex) / 2, lineY - 95, ex, lineY - 12);
      ctx.stroke();

      ctx.fillStyle = '#81c995';
      ctx.beginPath();
      ctx.arc(ex, lineY, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#a8c7fa';
      ctx.font = 'bold 18px Inter, sans-serif';
      ctx.textAlign = 'center';
      const delta = end - start;
      ctx.fillText(
        `Start at ${start}  →  Move ${delta >= 0 ? `+${delta}` : delta}  →  Land at ${end}`,
        W / 2,
        52
      );
      return;
    }

    if (type === 'ratio_bars') {
      const valA = Math.max(1, Number(spec.valueA) || 3);
      const valB = Math.max(1, Number(spec.valueB) || 5);
      const maxV = Math.max(valA, valB, 1);
      const unitW = Math.min(72, Math.floor((W - 240) / maxV));

      const drawTape = (y, label, count, color) => {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 18px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${label} (${count}):`, 155, y + 32);

        for (let i = 0; i < count; i++) {
          const bx = 175 + i * (unitW + 4);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(bx, y, unitW, 46, 6);
          ctx.fill();
        }
      };

      drawTape(75, spec.labelA || 'Part A', valA, '#4f9cf9');
      drawTape(165, spec.labelB || 'Part B', valB, '#34d399');
      return;
    }

    // Default / `area_model`
    const rectX = 190;
    const rectY = 65;
    const rectW = 380;
    const rectH = 165;
    ctx.fillStyle = 'rgba(79, 156, 249, 0.22)';
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(rectX, rectY, rectW, rectH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 21px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.insideLabel || 'Area = Length × Width', rectX + rectW / 2, rectY + rectH / 2 + 7);

    ctx.fillStyle = '#fdd663';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText(spec.widthLabel || 'Length', rectX + rectW / 2, rectY - 14);
    ctx.fillText(spec.heightLabel || 'Width', rectX - 65, rectY + rectH / 2 + 6);
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
    const instrBanner = document.getElementById('micTurnInstructionBanner');
    const instrIcon = document.getElementById('micInstrIcon');
    const instrTitle = document.getElementById('micInstrTitle');
    const instrText = document.getElementById('micInstrText');
    const studentInput = document.getElementById('studentInput');

    if (!this.avionics.isMicActive) {
      btnToggleMic.className = 'mic-pill-btn';
      micBtnLabel.textContent = 'Speak';
      statusDot.className = 'status-dot';
      vadStateTag.textContent = this.isBotSpeaking
        ? 'Tutor speaking...'
        : 'Mic off — click Speak to talk with the tutor';

      if (instrBanner && instrIcon && instrTitle && instrText) {
        if (this.isBotSpeaking) {
          instrBanner.className = 'mic-instruction-banner muted-wait';
          instrIcon.textContent = '🔊';
          instrTitle.textContent = 'Tutor Explaining Concept:';
          instrText.textContent =
            'Please wait until the tutor finishes speaking before intervening (or click "■ Stop Speaking" to interrupt).';
        } else {
          instrBanner.className = 'mic-instruction-banner idle';
          instrIcon.textContent = '🎤';
          instrTitle.textContent = 'Voice Turn-Taking Guide:';
          instrText.textContent =
            'Click "Speak" to enable your microphone. While the tutor explains concepts, the mic auto-mutes to prevent speaker echo—wait for the green "Speak Now" banner before talking.';
        }
      }
      if (studentInput) {
        studentInput.placeholder = this.isBotSpeaking
          ? '🔊 Tutor is explaining — please wait for voice to finish or type your response...'
          : "Ask any STEM question, ask to 'graph y = ...', or click Speak to use your voice...";
      }
      return;
    }

    if (this.isBotSpeaking || this.isMutedForEcho) {
      btnToggleMic.className = 'mic-pill-btn echo-paused';
      micBtnLabel.textContent = 'Mic Paused';
      statusDot.className = 'status-dot muted-echo';
      vadStateTag.textContent = 'Tutor speaking — microphone auto-muted to prevent speaker echo';

      if (instrBanner && instrIcon && instrTitle && instrText) {
        instrBanner.className = 'mic-instruction-banner muted-wait';
        instrIcon.textContent = '🔇';
        instrTitle.textContent = 'Mic Auto-Muted While Tutor Explains — Please Hold Your Voice:';
        instrText.textContent =
          'To prevent speaker feedback, your mic is muted while the tutor speaks. Please wait until the voice finishes before speaking (or click "■ Stop Speaking" to interrupt).';
      }
      if (studentInput) {
        studentInput.placeholder =
          '🔇 Mic auto-muted while tutor speaks — please wait until explanation finishes before speaking...';
      }
    } else {
      btnToggleMic.className = 'mic-pill-btn active';
      micBtnLabel.textContent = 'Listening';
      statusDot.className = 'status-dot listening';
      vadStateTag.textContent = this.isUserSpeaking
        ? 'Hearing you speak — smart pause detector active...'
        : 'Mic active & ready — speak now (2.4s smart pause detector)...';

      if (instrBanner && instrIcon && instrTitle && instrText) {
        instrBanner.className = 'mic-instruction-banner ready-listen';
        instrIcon.textContent = '🟢';
        instrTitle.textContent = 'Mic Ready — Speak Now!';
        instrText.textContent = this.isUserSpeaking
          ? 'Hearing your voice clearly — keep speaking at your own pace.'
          : 'Tutor has finished speaking. Your microphone is live and will pick up your very first word immediately.';
      }
      if (studentInput) {
        studentInput.placeholder = '🟢 Mic is active & listening — Speak now, or type your response here...';
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.svsApp = new SocraticGeminiChatApp();
});
