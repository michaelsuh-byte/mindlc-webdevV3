/**
 * Ontario STEM Socratic Voice Tutor — Dual-Channel HUD + Gemini Chat UI Controller
 * Implements CAN-ON-SVS-01 + Service Bulletin CAN-ON-SVS-SB-02:
 *  - Channel 1 (<hud>...</hud>): Instant 0ms KaTeX Visual Step Rendering on DOM
 *  - Channel 2 (Spoken Audio): Stripped of <hud>, routed exclusively to Studio Neural Human Voice (/api/tts)
 */

import {
  VOCAL_PROFILES,
  NEURAL_HUMAN_VOICES,
  FLIGHT_MODES,
  STEM_SCENARIOS,
  buildSystemInstruction,
  parseDualChannelPacket,
  detectSystemCommand,
  generateOfflineSocraticResponse
} from './svs-engine.js';

import { AudioAvionicsController } from './audio-avionics.js';

class SocraticGeminiChatApp {
  constructor() {
    this.activeProfileKey = 'CHARLIE';
    this.activeModeId = 1;
    this.maxWords = 30; // SB-02 Default: 30 words ceiling for spoken Channel 2
    this.geminiApiKey = '';
    this.conversationHistory = [];
    this.lastSpokenBurst = 'Hi there! What Ontario high school math, physics, or chemistry problem are we solving today?';

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
      }
    });

    this.initUI();

    this.appendChatMessage(
      'svs',
      'Hi! I am your Ontario high school STEM tutor with Dual-Channel Math HUD and natural human voice. Equations appear visually on your screen while I talk you through each step.',
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

    document.getElementById('btnClearLog').addEventListener('click', () => {
      this.conversationHistory = [];
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
          'Active: Gemini 2.5 Flash + Dual-Channel SB-02';
      });
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
    this.avionics.stopSpeaking('NEW_STUDENT_TURN');
    this.appendChatMessage('student', utterance);

    const sysCmd = detectSystemCommand(utterance);
    if (sysCmd && sysCmd.type === 'MODE_SWITCH') {
      this.selectMode(sysCmd.mode);
      this.emitDualChannelResponse(sysCmd.response, { speak: true });
      return;
    }

    const thinkingEl = this.appendThinkingBubble();

    try {
      const llmReply = await this.fetchServerGeminiChat(utterance);
      thinkingEl.remove();

      if (llmReply) {
        this.conversationHistory.push({ role: 'user', text: utterance });
        this.conversationHistory.push({ role: 'svs', text: llmReply });
        this.emitDualChannelResponse(llmReply, { speak: true });
        return;
      }
    } catch (err) {
      thinkingEl.remove();
      console.warn('Server chat fallback:', err);
    }

    const simResult = generateOfflineSocraticResponse(utterance, this.activeModeId, this.activeProfileKey);
    this.emitDualChannelResponse(simResult.text, { speak: true });
  }

  async fetchServerGeminiChat(utterance) {
    const sysPrompt = buildSystemInstruction(this.activeProfileKey, this.activeModeId, this.maxWords);
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: sysPrompt,
        history: this.conversationHistory,
        message: utterance,
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
   * SERVICE BULLETIN CAN-ON-SVS-SB-02 DUAL-CHANNEL DISPATCH:
   *  1. Extracts `<hud>...</hud>` and renders LaTeX to DOM immediately (0ms lag)
   *  2. Strips `<hud>...</hud>` from the audio buffer and dispatches only the spoken inquiry to TTS
   */
  emitDualChannelResponse(rawText, options = { speak: true, badge: '' }) {
    const t0 = performance.now();
    const packet = parseDualChannelPacket(rawText, this.maxWords);

    // 1. Update Pinned Live HUD Banner immediately if packet includes <hud> LaTeX
    if (packet.hudLatex) {
      this.updatePinnedLiveHud(packet.hudLatex, performance.now() - t0);
    }

    const profile = VOCAL_PROFILES[this.activeProfileKey];
    const mode = FLIGHT_MODES[this.activeModeId];
    const voiceName = this.avionics.getSelectedNeuralVoiceName(this.activeProfileKey);
    const footerTag = options.badge
      ? `${profile.code} (${voiceName}) • ${options.badge}`
      : `${profile.code} (${voiceName}) • ${mode.name}`;

    // 2. Render chat bubble with both the silent HUD Math Card + spoken inquiry text
    this.appendChatMessage('svs', packet.spokenText, footerTag, packet.hudLatex);

    // 3. Route ONLY the stripped spoken inquiry (Channel 2) to the Neural Voice synthesizer
    if (packet.spokenText) {
      this.lastSpokenBurst = packet.spokenText;
      if (options.speak) {
        this.avionics.speakCalibratedBurst(packet.spokenText, this.activeProfileKey);
      }
    }
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

    // Channel 1: Render <hud> Visual Math Card inside the tutor bubble before spoken text
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

    // Channel 2: Spoken Inquiry Text
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
        ? 'Tutor speaking (HUD equation displayed silently)...'
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
