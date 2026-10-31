/**
 * Ontario STEM Socratic Voice Tutor — Tri-Channel HUD, Telemetry & Gemini Chat Controller
 * Includes:
 *  1. Strict Pre-Render LaTeX Screening Layer (`sanitizeLatexForHud`) + Clean History Normalization
 *  2. Stoppable / Pausable Deliberation Timer (`⏸ Pause`, `⏹ Stop Timer`, auto-stop at t_expected)
 *  3. High-Density Compact Chat Layout
 *  4. Context-Aware Varied Check-In Messages (`generateContextualCheckIn`)
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
  computeRetroactiveAttribution,
  generateContextualCheckIn,
  detectSystemCommand,
  generateOfflineSocraticResponse
} from './svs-engine.js';

import { AudioAvionicsController } from './audio-avionics.js';

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
      'Hi! I am your Ontario high school STEM tutor with Tri-Channel Math HUD, Deliberation Telemetry, and natural human voice. Pick a starter problem below or ask any STEM question.',
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

    document.getElementById('btnBargeIn').addEventListener('click', () => {
      this.avionics.stopSpeaking('USER_STOP_BUTTON');
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
      this.conversationHistory = [];
      this.stopScratchpadDeliberationClock();
      this.hasActiveProblemTurn = false;
      this.lastHudLatex = '';
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
      document.getElementById('vadThresholdValue').textContent = `${ms} ms`;
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
    this.lastStudentUtterance = utterance;
    this.avionics.stopSpeaking('NEW_STUDENT_TURN');

    this.appendChatMessage('student', utterance);

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
          `<telemetry>${JSON.stringify(parsedPacket.telemetry)}</telemetry>\n` +
          parsedPacket.spokenText;

        this.conversationHistory.push({ role: 'user', text: utterance });
        this.conversationHistory.push({ role: 'svs', text: cleanAssistantHistoryText });
        this.hasActiveProblemTurn = true;
        this.emitTriChannelResponse(llmReply, {
          speak: true,
          fallbackTelemetry: retroactiveTelemetry
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
      fallbackTelemetry: retroactiveTelemetry
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

  appendThinkingBubble() {
    const log = document.getElementById('commsLog');
    const row = document.createElement('div');
    row.className = 'chat-msg svs';
    row.innerHTML = `
      <div class="msg-avatar">✦</div>
      <div class="msg-bubble" style="color: var(--text-muted); font-style: italic;">
        Thinking...
      </div>
    `;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  emitTriChannelResponse(rawText, options = { speak: true, badge: '', fallbackTelemetry: null }) {
    const t0 = performance.now();
    const packet = parseTriChannelPacket(rawText, this.maxWords, options.fallbackTelemetry);

    if (packet.hudLatex) {
      this.lastHudLatex = packet.hudLatex;
      this.updatePinnedLiveHud(packet.hudLatex, performance.now() - t0);
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

    this.appendChatMessage('svs', packet.spokenText, footerTag, packet.hudLatex);

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

  appendChatMessage(role, spokenText, footerText = '', hudLatex = '') {
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
        ? 'Hearing you speak...'
        : 'Listening for your voice (click Listening to turn off mic)';
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.svsApp = new SocraticGeminiChatApp();
});
