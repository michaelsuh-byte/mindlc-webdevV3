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

    // End-of-Session Manim Consent State
    this.awaitingManimConsent = false;
    this.activeManimController = null;

    // Section 10 & 20: Telemetry & Deliberation Timer State
    this.currentTelemetry = { ...DEFAULT_TELEMETRY };
    this.autoScratchpadPing = true;
    this.isTimerPaused = false;
    this.pausedElapsedSec = 0;
    this.delibStartTimestamp = 0;
    this.delibInterval = null;
    this.softPingIssuedForTurn = false;
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

        if (!speaking && this.hasActiveProblemTurn && !this.softPingIssuedForTurn && this.autoScratchpadPing) {
          this.startScratchpadDeliberationClock();
        }
      }
    });

    this.initUI();
    this.updateTelemetryUI(this.currentTelemetry);

    this.appendChatMessage(
      'svs',
      'Hi! I am your Ontario high school STEM tutor with Tri-Channel Math HUD, Interactive Graphing, Smart Speech Pause Detection, and Manim Instructional Video generation. Pick a starter problem below or ask any STEM question.',
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
      this.awaitingManimConsent = false;
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
   * Explicitly ends the current question session and asks the user if they want a Manim instructional video
   */
  offerEndOfSessionManimVideo() {
    this.awaitingManimConsent = true;
    const spoken =
      'We have completed this question session! Would you like to see a full instructional video using the Manim engine and voice explanation on the question we just discussed?';
    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    this.appendChatMessage(
      'svs',
      spoken,
      `${profile.code} (${voiceName}) • End of Session Offer`,
      this.lastHudLatex,
      { offerManim: true }
    );
    this.lastSpokenBurst = spoken;
    this.avionics.speakCalibratedBurst(spoken, this.activeProfileKey);
  }

  /**
   * Handles the user's YES or NO response to the End-of-Session Manim video prompt
   */
  async handleManimConsentDecision(decision) {
    this.awaitingManimConsent = false;
    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);

    if (decision === 'NO') {
      const noReply = 'No problem at all! Let me know what STEM question or topic you would like to explore next.';
      this.appendChatMessage(
        'svs',
        noReply,
        `${profile.code} (${voiceName}) • Session Complete`,
        ''
      );
      this.lastSpokenBurst = noReply;
      this.avionics.speakCalibratedBurst(noReply, this.activeProfileKey);
      return;
    }

    // User chose YES -> Generate Manim Storyboard and render Manim Canvas Video Player in chat
    const loadingRow = this.appendThinkingBubble(
      `Rendering Manim instructional video scenes & synchronizing ${voiceName} voiceover...`
    );

    try {
      const storyboard = await this.fetchManimStoryboard();
      loadingRow.remove();

      const introText = `Here is your full Manim instructional video for "${storyboard.title}", narrated with the ${voiceName} voice model.`;
      this.appendChatMessage(
        'svs',
        introText,
        `${profile.code} (${voiceName}) • Manim Engine Video`,
        '',
        { manimStoryboard: storyboard }
      );
    } catch (err) {
      loadingRow.remove();
      console.warn('Manim generation error, using fallback storyboard:', err);
      const fallbackStoryboard = this.buildClientFallbackManimStoryboard();
      this.appendChatMessage(
        'svs',
        `Here is your full Manim instructional video for "${fallbackStoryboard.title}", narrated with the ${voiceName} voice model.`,
        `${profile.code} (${voiceName}) • Manim Engine Video`,
        '',
        { manimStoryboard: fallbackStoryboard }
      );
    }
  }

  async fetchManimStoryboard() {
    const topicHint =
      this.lastStudentUtterance ||
      this.lastHudLatex ||
      'Ontario Secondary STEM Problem Walkthrough';

    const res = await fetch('/api/manim-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: this.conversationHistory,
        topicHint,
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
      title: 'Formal Step-by-Step Solution & Concept Proof',
      course: 'Ontario STEM (MCR3U / MHF4U / MCV4U)',
      xDomain: [-5, 4],
      yDomain: [-4, 10],
      scenes: [
        {
          heading: 'Step 1: Formal Problem Statement & Standard Form',
          conceptTag: 'Standard Form Identification: ax² + bx + c = 0',
          latex: cleanLatex,
          annotation: 'Express the equation in standard polynomial form and identify all constant coefficients.',
          narration: 'We begin our formal solution by writing the equation in standard form and identifying its exact coefficients: leading coefficient a equals two, linear coefficient b equals five, and constant c equals two.',
          graphExpr: fnExpr,
          highlightPoint: [0, 2]
        },
        {
          heading: 'Step 2: Governing Principle — The ac-Decomposition Theorem',
          conceptTag: 'Theorem: Find integers p, q such that p·q = a·c and p + q = b',
          latex: 'a \\cdot c = 2 \\times 2 = 4, \\quad b = 5 \\implies p = 4,\\; q = 1',
          annotation: 'Since a·c = 4 and b = 5, the unique factor pair satisfying both conditions is p = 4 and q = 1.',
          narration: 'By the decomposition factoring theorem, we multiply the leading coefficient a by the constant c to obtain four. We then determine the two integers that multiply to positive four and sum to positive five, which are four and one.',
          graphExpr: fnExpr,
          highlightPoint: [-1.25, -1.125]
        },
        {
          heading: 'Step 3: Splitting the Linear Term & Factoring by Grouping',
          conceptTag: 'Distributive Law: Group Pairs & Extract Common Monomials',
          latex: '2x^2 + 4x + 1x + 2 = 0 \\implies 2x(x + 2) + 1(x + 2) = 0',
          annotation: 'Decompose 5x into 4x + 1x, then factor 2x from the first group and 1 from the second group.',
          narration: 'Next, we rewrite the middle term five x as four x plus one x. Factoring by grouping allows us to extract two x from the first pair of terms and positive one from the second pair, producing a common binomial factor of x plus two.',
          graphExpr: fnExpr,
          highlightPoint: [-2, 0]
        },
        {
          heading: 'Step 4: Complete Factorization & Zero-Product Property',
          conceptTag: 'Zero-Product Property: A · B = 0 ⟺ A = 0 or B = 0',
          latex: '(2x + 1)(x + 2) = 0 \\implies 2x + 1 = 0 \\;\\text{ or }\\; x + 2 = 0',
          annotation: 'Factor out (x + 2) completely and set each linear factor equal to zero.',
          narration: 'Factoring out the shared binomial x plus two gives the fully factored equation: two x plus one, multiplied by x plus two, equals zero. Applying the Zero-Product Property, we set each linear factor equal to zero independently.',
          graphExpr: fnExpr,
          highlightPoint: [-0.5, 0]
        },
        {
          heading: 'Step 5: Exact Solution Set & Graphical Verification',
          conceptTag: 'Final Verified Roots & Coordinate Intercepts',
          latex: '\\therefore x_1 = -\\frac{1}{2} = -0.5, \\quad x_2 = -2',
          annotation: 'Both roots are verified as the exact x-intercepts (-2, 0) and (-0.5, 0) on the parabola.',
          narration: 'Solving each linear equation yields our final exact solutions: x equals negative one half, and x equals negative two. On the coordinate plane, these two algebraic roots correspond directly to the horizontal x-intercepts of the parabola.',
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
      if (this.hasActiveProblemTurn && !this.isBotSpeaking && !this.softPingIssuedForTurn) {
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
   * Tracks student deliberation time up to t_expected, then automatically stops
   */
  startScratchpadDeliberationClock(resumeFromSeconds = 0) {
    this.stopScratchpadDeliberationClock();
    if (!this.autoScratchpadPing || this.isTimerPaused) return;

    this.delibStartTimestamp = performance.now() - resumeFromSeconds * 1000;
    const tierObj = STEP_TIERS[this.currentTelemetry.step_tier] || STEP_TIERS[1];
    const expectedSec = tierObj.expectedSec;

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
        timerEl.textContent = `${elapsedSec.toFixed(1)}s / ${expectedSec}s`;
      }
      if (fillEl) {
        fillEl.style.width = `${pct}%`;
        fillEl.style.backgroundColor = elapsedSec >= expectedSec ? '#fdd663' : '#a8c7fa';
      }

      if (elapsedSec >= 4.0 && this.currentTelemetry.delib_state === 'IMMEDIATE') {
        this.currentTelemetry.delib_state = 'SCRATCHPAD_ACTIVE';
        this.updateDelibBadgeUI('SCRATCHPAD_ACTIVE');
      }

      // Stop counting once t_expected is reached and issue a context-aware check-in once
      if (elapsedSec >= expectedSec) {
        this.stopScratchpadDeliberationClock();
        if (!this.softPingIssuedForTurn) {
          this.softPingIssuedForTurn = true;
          this.triggerScratchpadSoftPing('AUTO_T_EXPECTED');
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
   * Issues a context-aware, varied supportive check-in tailored to the current conversation
   */
  triggerScratchpadSoftPing(reason = 'AUTO_T_EXPECTED') {
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
    const footerTag = `${profile.code} (${voiceName}) • Check-In (${reason === 'MANUAL_TEST' ? 'Test' : 'Deliberation Pause'})`;

    this.appendChatMessage('svs', checkInPacket.spokenText, footerTag, '');
    this.lastSpokenBurst = checkInPacket.spokenText;
    this.avionics.speakCalibratedBurst(checkInPacket.spokenText, this.activeProfileKey);
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

    this.softPingIssuedForTurn = false;
    this.avionics.stopSpeaking('NEW_STUDENT_TURN');

    this.appendChatMessage('student', utterance);

    // Check if we are currently waiting for Yes/No consent for the End-of-Session Manim video,
    // OR if the last tutor turn mentioned video/manim/animation/solution and the student replied Yes/No
    const consentIntent = detectManimConsentIntent(utterance);
    const lastTutorMentionedVideo = /\b(manim|video|animation|walkthrough|full\s+solution|would\s+you\s+like)\b/i.test(
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
    const annotatedMessage =
      pauseSeconds >= 5
        ? `[Student Deliberation Pause: ${pauseSeconds.toFixed(1)}s | Previous Step Tier: ${tierObj.tier} (t_expected=${tierObj.expectedSec}s)]\n${utterance}`
        : utterance;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: sysPrompt,
        history: this.conversationHistory,
        message: annotatedMessage,
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
    const spokenMentionsManim = /\b(manim|instructional\s+video)\b/i.test(packet.spokenText || '');
    const isSessionComplete = Boolean(packet.telemetry.session_complete || spokenMentionsManim);
    if (isSessionComplete) {
      this.awaitingManimConsent = true;
    }

    this.currentTelemetry = packet.telemetry;
    this.updateTelemetryUI(this.currentTelemetry);

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const mode = FLIGHT_MODES[this.activeModeId];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const tierLabel = `Tier ${packet.telemetry.step_tier} • ${packet.telemetry.delib_state}`;
    const footerTag = options.badge
      ? `${profile.code} (${voiceName}) • ${options.badge}`
      : `${profile.code} (${voiceName}) • ${mode.name} • ${tierLabel}`;

    this.appendChatMessage('svs', packet.spokenText, footerTag, packet.hudLatex, {
      graphSpec,
      offerManim: isSessionComplete
    });

    if (packet.spokenText) {
      this.lastSpokenBurst = packet.spokenText;
      if (options.speak) {
        this.avionics.speakCalibratedBurst(packet.spokenText, this.activeProfileKey);
      } else if (this.hasActiveProblemTurn && this.autoScratchpadPing) {
        this.startScratchpadDeliberationClock();
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

    // 1. Interactive Open-Source Graphing Calculator Card inside the chat bubble
    if (role === 'svs' && attachments.graphSpec) {
      const graphWidget = createInteractiveGraphElement(attachments.graphSpec);
      bubble.appendChild(graphWidget);
    }

    // 2. End-of-Session Manim Instructional Video Consent Offer Card
    if (role === 'svs' && attachments.offerManim) {
      const offerCard = document.createElement('div');
      offerCard.className = 'manim-offer-card';

      const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
      offerCard.innerHTML = `
        <div class="manim-offer-title">🎬 End-of-Session Manim Instructional Video</div>
        <div class="manim-offer-desc">
          Would you like me to generate a full animated Manim instructional video in the chat (narrated by <strong>${voiceName}</strong>) for the question we just discussed?
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'manim-offer-actions';

      const yesBtn = document.createElement('button');
      yesBtn.type = 'button';
      yesBtn.className = 'manim-yes-btn';
      yesBtn.textContent = '🎬 Yes, Create Manim Video';

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
      const profile = VOCAL_PROFILES[this.activeProfileKey] || VOCAL_PROFILES.CHARLIE;
      const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
      const playbackRate = Math.max(
        0.75,
        Math.min(1.35, profile.baseRate * this.avionics.customRateMultiplier)
      );

      const manimWidget = createManimVideoElement(attachments.manimStoryboard, {
        voiceName,
        playbackRate,
        apiKey: this.geminiApiKey,
        onPlaybackStateChange: (playing) => {
          this.avionics.setBotSpeakingState(playing);
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
        manimQuickBtn.textContent = '🎬 Full Solution Video';
        manimQuickBtn.title = 'Generate step-by-step formal Manim solution video in chat';
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
