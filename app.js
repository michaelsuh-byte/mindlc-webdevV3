/**
 * Ontario STEM Socratic Voice Tutor — Tri-Channel HUD, Telemetry & Gemini Chat Controller
 * Implements:
 *  - Section 00: Multi-Channel Decoupling (<hud>, <telemetry>, Spoken Audio)
 *  - Section 10: Off-Screen Scratchpad & Deliberation Protocol (Tier 1=5s, Tier 2=20s, Tier 3=45s, Soft-Ping, Retroactive Attribution)
 *  - Section 20: Live Telemetry JSON Engine
 */

import {
  VOCAL_PROFILES,
  NEURAL_HUMAN_VOICES,
  FLIGHT_MODES,
  STEP_TIERS,
  DEFAULT_TELEMETRY,
  STEM_SCENARIOS,
  buildSystemInstruction,
  parseTriChannelPacket,
  computeRetroactiveAttribution,
  generateScratchpadSoftPing,
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
    this.lastHudLatex = '';

    // Section 10 & 20: Telemetry & Off-Screen Scratchpad Deliberation State
    this.currentTelemetry = { ...DEFAULT_TELEMETRY };
    this.autoScratchpadPing = true;
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

        // Start off-screen scratchpad deliberation clock once tutor finishes speaking a problem turn
        if (!speaking && this.hasActiveProblemTurn && !this.softPingIssuedForTurn) {
          this.startScratchpadDeliberationClock();
        }
      }
    });

    this.initUI();
    this.updateTelemetryUI(this.currentTelemetry);

    this.appendChatMessage(
      'svs',
      'Hi! I am your Ontario high school STEM tutor with Tri-Channel HUD, Scratchpad Deliberation Telemetry, and natural human voice. Pick a starter problem below or ask any STEM question.',
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

    // Test Section 10.2 Non-Intrusive Soft-Ping Button
    document.getElementById('btnTriggerSoftPing').addEventListener('click', () => {
      this.triggerScratchpadSoftPing('MANUAL_TEST');
    });

    // Auto Scratchpad Soft-Ping Toggle
    document.getElementById('chkScratchpadPing').addEventListener('change', (e) => {
      this.autoScratchpadPing = e.target.checked;
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
   * Section 10: Off-Screen Scratchpad & Deliberation Timer
   * Tracks student pause duration against Tier 1 (5s), Tier 2 (20s), or Tier 3 (45s) t_expected
   */
  startScratchpadDeliberationClock() {
    this.stopScratchpadDeliberationClock();
    this.delibStartTimestamp = performance.now();

    const tierObj = STEP_TIERS[this.currentTelemetry.step_tier] || STEP_TIERS[1];
    const expectedSec = tierObj.expectedSec;

    this.delibInterval = setInterval(() => {
      if (this.isBotSpeaking) {
        this.delibStartTimestamp = performance.now();
        return;
      }

      const elapsedSec = (performance.now() - this.delibStartTimestamp) / 1000;
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

      // Transition visual badge to SCRATCHPAD_ACTIVE after 3 seconds of off-screen calculation
      if (elapsedSec >= 3.0 && this.currentTelemetry.delib_state === 'IMMEDIATE') {
        this.currentTelemetry.delib_state = 'SCRATCHPAD_ACTIVE';
        this.updateDelibBadgeUI('SCRATCHPAD_ACTIVE');
      }

      // Section 10.2: Non-Intrusive Soft-Ping when silence exceeds t_expected
      if (this.autoScratchpadPing && !this.softPingIssuedForTurn && elapsedSec >= expectedSec) {
        this.softPingIssuedForTurn = true;
        this.triggerScratchpadSoftPing('AUTO_T_EXPECTED');
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
    if (!this.delibStartTimestamp) return 0;
    return Math.max(0, (performance.now() - this.delibStartTimestamp) / 1000);
  }

  /**
   * Section 10.2: Issues the Non-Intrusive Soft-Ping when silence exceeds t_expected
   */
  triggerScratchpadSoftPing(reason = 'AUTO_T_EXPECTED') {
    const pingPacket = generateScratchpadSoftPing(this.currentTelemetry.step_tier, this.lastHudLatex);
    this.currentTelemetry = pingPacket.telemetry;
    this.updateTelemetryUI(this.currentTelemetry);

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const footerTag = `${profile.code} (${voiceName}) • Soft-Ping (${reason === 'MANUAL_TEST' ? 'Test' : `t_exp Exceeded`})`;

    this.appendChatMessage('svs', pingPacket.spokenText, footerTag, '');
    this.lastSpokenBurst = pingPacket.spokenText;
    this.avionics.speakCalibratedBurst(pingPacket.spokenText, this.activeProfileKey);
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
    this.softPingIssuedForTurn = false;
    this.avionics.stopSpeaking('NEW_STUDENT_TURN');

    this.appendChatMessage('student', utterance);

    // Compute Section 10.3 Retroactive Attribution baseline from pause duration & utterance
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
        this.conversationHistory.push({ role: 'user', text: utterance });
        this.conversationHistory.push({ role: 'svs', text: llmReply });
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
      pauseSeconds >= 4
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

  /**
   * CAN-ON-SVS-PROTOTYPE TRI-CHANNEL DISPATCH:
   *  - Channel 1 (<hud>): Instant 0ms KaTeX render to DOM
   *  - Channel 2 (<telemetry>): Updates live Cognitive Telemetry & Scratchpad Tier clock
   *  - Channel 3 (Spoken Audio): Stripped of <hud> & <telemetry>, routed to Studio Neural Voice
   */
  emitTriChannelResponse(rawText, options = { speak: true, badge: '', fallbackTelemetry: null }) {
    const t0 = performance.now();
    const packet = parseTriChannelPacket(rawText, this.maxWords, options.fallbackTelemetry);

    // 1. Channel 1: Update Pinned Live HUD Banner immediately if packet includes <hud> LaTeX
    if (packet.hudLatex) {
      this.lastHudLatex = packet.hudLatex;
      this.updatePinnedLiveHud(packet.hudLatex, performance.now() - t0);
    }

    // 2. Channel 2: Update Live Telemetry Dashboard & Complexity Tier Latency Envelope
    this.currentTelemetry = packet.telemetry;
    this.updateTelemetryUI(this.currentTelemetry);

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const mode = FLIGHT_MODES[this.activeModeId];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const tierLabel = `Tier ${packet.telemetry.step_tier} • ${packet.telemetry.delib_state}`;
    const footerTag = options.badge
      ? `${profile.code} (${voiceName}) • ${options.badge}`
      : `${profile.code} (${voiceName}) • ${mode.name} • ${tierLabel}`;

    // 3. Render chat bubble with silent HUD Math Card + spoken inquiry text
    this.appendChatMessage('svs', packet.spokenText, footerTag, packet.hudLatex);

    // 4. Channel 3: Route ONLY the stripped spoken inquiry to the Neural Voice synthesizer
    if (packet.spokenText) {
      this.lastSpokenBurst = packet.spokenText;
      if (options.speak) {
        this.avionics.speakCalibratedBurst(packet.spokenText, this.activeProfileKey);
      } else if (this.hasActiveProblemTurn) {
        this.startScratchpadDeliberationClock();
      }
    }
  }

  updateTelemetryUI(telemetry) {
    const tierObj = STEP_TIERS[telemetry.step_tier] || STEP_TIERS[1];

    // Update top strip
    const tierBadge = document.getElementById('stripTierBadge');
    if (tierBadge) {
      tierBadge.textContent = `TIER ${tierObj.tier} (t_exp = ${tierObj.expectedSec}s)`;
    }

    this.updateDelibBadgeUI(telemetry.delib_state);

    const timerEl = document.getElementById('stripScratchpadTimer');
    const fillEl = document.getElementById('stripScratchpadFill');
    if (timerEl) timerEl.textContent = `0.0s / ${tierObj.expectedSec}s`;
    if (fillEl) fillEl.style.width = '0%';

    const hintBadge = document.getElementById('stripHintBadge');
    if (hintBadge) {
      hintBadge.textContent = `Level ${telemetry.hint_level} / 4`;
    }

    // Update sidebar Channel 2 gauges
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
      latencyTag.textContent = `${Math.max(0.2, elapsedMs).toFixed(1)} ms KaTeX Render`;
    }
  }

  renderLatexElement(targetEl, latexStr) {
    if (window.katex) {
      try {
        window.katex.render(latexStr, targetEl, {
          displayMode: true,
          throwOnError: false
        });
        return;
      } catch (err) {
        console.warn('KaTeX render fallback:', err);
      }
    }
    targetEl.textContent = latexStr;
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
      const hudCard = document.createElement('div');
      hudCard.className = 'hud-math-card';

      const hudTag = document.createElement('span');
      hudTag.className = 'hud-math-tag';
      hudTag.textContent = 'HUD // ACTIVE EQUATION STEP';
      hudCard.appendChild(hudTag);

      const mathBody = document.createElement('div');
      this.renderLatexElement(mathBody, hudLatex);
      hudCard.appendChild(mathBody);

      bubble.appendChild(hudCard);
    }

    const p = document.createElement('div');
    p.textContent = spokenText;
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
        this.avionics.speakCalibratedBurst(spokenText, this.activeProfileKey);
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
        ? 'Tutor speaking (HUD & Telemetry updated silently)...'
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
