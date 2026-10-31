/**
 * Ontario Secondary STEM Socratic Voice Tutor Engine
 * Implements:
 *  - CAN-ON-SVS-01 Core Socratic Voice System
 *  - Service Bulletin CAN-ON-SVS-SB-02 (<hud> Visual LaTeX Stepping)
 *  - CAN-ON-SVS-PROTOTYPE Tri-Channel Decoupling (<hud>, <telemetry>, Spoken Audio)
 *  - Section 10: Off-Screen Scratchpad & Deliberation Protocol (Tier 1/2/3 Latency & Retroactive Attribution)
 *  - Section 20: Telemetry JSON Schema
 */

export const NEURAL_HUMAN_VOICES = [
  { id: 'Aoede', label: 'Aoede — Warm & Natural Female Teacher' },
  { id: 'Puck', label: 'Puck — Friendly & Conversational Male Tutor' },
  { id: 'Kore', label: 'Kore — Clear & Calm Female Explainer' },
  { id: 'Charon', label: 'Charon — Reassuring & Patient Male Mentor' },
  { id: 'Fenrir', label: 'Fenrir — Steady & Focused Exam Coach' },
  { id: 'Leda', label: 'Leda — Upbeat & Encouraging Study Partner' },
  { id: 'Zephyr', label: 'Zephyr — Smooth & Expressive Female Voice' },
  { id: 'Orus', label: 'Orus — Structured & Clear Male Voice' }
];

export const STEP_TIERS = {
  1: { tier: 1, name: 'TIER 1 (Recall / Concept)', expectedSec: 5 },
  2: { tier: 2, name: 'TIER 2 (1–2 Step Algebra)', expectedSec: 20 },
  3: { tier: 3, name: 'TIER 3 (Multi-Step Derivation / Contest)', expectedSec: 45 }
};

export const DEFAULT_TELEMETRY = {
  step_tier: 1,
  delib_state: 'IMMEDIATE',
  i_flow: 85,
  i_eff: 85,
  i_reg: 85,
  cli: 35,
  hint_level: 0
};

export const VOCAL_PROFILES = {
  ALPHA: {
    id: 'ALPHA',
    code: 'Warm Mentor',
    title: 'Warm & Patient Mentor',
    subtitle: 'Calm, reassuring, step-by-step pacing',
    pitchHz: 110,
    rateWpm: 140,
    ttsPitch: 0.98,
    ttsRate: 0.96,
    geminiVoice: 'Charon',
    preferredKeywords: ['Guy', 'Christopher', 'Natural']
  },
  BRAVO: {
    id: 'BRAVO',
    code: 'Clear Analyst',
    title: 'Clear STEM Explainer',
    subtitle: 'Crisp, structured, analytical clarity',
    pitchHz: 150,
    rateWpm: 150,
    ttsPitch: 1.0,
    ttsRate: 1.0,
    geminiVoice: 'Puck',
    preferredKeywords: ['Aria', 'Jenny', 'Natural']
  },
  CHARLIE: {
    id: 'CHARLIE',
    code: 'Encouraging Coach',
    title: 'Encouraging Study Coach',
    subtitle: 'Upbeat, conversational, curious',
    pitchHz: 180,
    rateWpm: 150,
    ttsPitch: 1.02,
    ttsRate: 1.02,
    geminiVoice: 'Aoede',
    preferredKeywords: ['Clara', 'Ava', 'Natural']
  },
  DELTA: {
    id: 'DELTA',
    code: 'Exam Guide',
    title: 'Calm Exam Prep Guide',
    subtitle: 'Focused, steady, low-stress pacing',
    pitchHz: 120,
    rateWpm: 135,
    ttsPitch: 0.97,
    ttsRate: 0.94,
    geminiVoice: 'Fenrir',
    preferredKeywords: ['Liam', 'Andrew', 'Natural']
  }
};

export const FLIGHT_MODES = {
  1: {
    id: 1,
    code: 'Mode 1',
    name: 'Socratic Hints',
    sublabel: 'Step-by-Step Inquiry',
    objective: 'Guide the student one micro-step at a time with visual math on the HUD and a concise guiding question.'
  },
  2: {
    id: 2,
    code: 'Mode 2',
    name: 'First Principles',
    sublabel: 'Why Formulas Work',
    objective: 'Derive formulas from first principles (secant slopes, conservation laws, completing the square) one delta-step at a time.'
  },
  3: {
    id: 3,
    code: 'Mode 3',
    name: 'Exam Practice',
    sublabel: 'Ontario Rubric & Common Traps',
    objective: 'Test Ontario curriculum problems while checking for domain restrictions, extraneous roots, and unit traps.'
  },
  4: {
    id: 4,
    code: 'Mode 4',
    name: 'Real-World Canada',
    sublabel: 'Everyday STEM Applications',
    objective: 'Connect classroom math, physics, and chemistry to real Canadian engineering and everyday applications.'
  }
};

export const FAULT_CODES = {
  401: {
    code: 401,
    label: 'Hint Tier Down',
    name: 'Student Unsure / Stuck',
    triggerDesc: 'When the student is unsure, simplify the visual HUD step and offer an easy A-or-B choice.',
    action: 'Offers a simpler micro-step and binary choice.'
  },
  402: {
    code: 402,
    label: 'Guided Setup',
    name: 'Direct Answer Request',
    triggerDesc: 'Display the starting equation on the HUD and walk through the first transformation together.',
    action: 'Shows the starting equation on the HUD and prompts the first step.'
  },
  403: {
    code: 403,
    label: 'Concept Check',
    name: 'Misconception Spotted',
    triggerDesc: 'Highlights the governing formula on the HUD and tests the premise with a quick example.',
    action: 'Uses a counter-example to clarify the concept.'
  }
};

/**
 * Compiles the full systemInstruction payload incorporating:
 *  - CAN-ON-SVS-01
 *  - Service Bulletin CAN-ON-SVS-SB-02
 *  - CAN-ON-SVS-PROTOTYPE Tri-Channel (<hud>, <telemetry>, Spoken Audio) & Scratchpad Deliberation Protocol
 */
export function buildSystemInstruction(profileKey = 'CHARLIE', modeId = 1, maxWords = 30) {
  const profile = VOCAL_PROFILES[profileKey] || VOCAL_PROFILES.CHARLIE;
  const mode = FLIGHT_MODES[modeId] || FLIGHT_MODES[1];

  return `You are a warm, knowledgeable Ontario High School STEM Teacher (Grades 9–12: Math, Calculus & Vectors MCV4U, Functions MCR3U/MHF4U, Physics SPH3U/SPH4U, Chemistry SCH3U/SCH4U).
Tutor Voice Persona: ${profile.title} (${profile.subtitle}).
Active Mode: ${mode.code} - ${mode.name} (${mode.objective}).

# [SYSTEM SPECIFICATION: FLIGHT OPERATIONS MANUAL - CAN-ON-SVS-PROTOTYPE]

## 00. OPERATIONAL DIRECTIVES & MULTI-CHANNEL DECOUPLING
The system operates simultaneously across three decoupled communication channels in a single response stream.

### OUTPUT CHANNEL SPECIFICATION:
1. \`<hud> ... </hud>\` (STUDENT DISPLAY):
   - Contains ONLY raw LaTeX expressions (\`$$display$$\` or \`$inline$\`) representing the current mathematical state or single micro-step delta.
   - Zero prose. Zero explanations. Stripped before audio synthesis.
2. \`<telemetry> ... </telemetry>\` (BACKEND DASHBOARD / METRIC ENGINE):
   - Emits a single-line minified JSON payload containing real-time cognitive tracking states.
   - Stripped before audio synthesis.
3. [PLAIN SPOKEN TEXT] (AUDIO SYNTHESIZER):
   - Everything outside \`<hud>\` and \`<telemetry>\` tags is routed exclusively to the voice emitter.
   - Strict 1–2 sentence limit (aim for 15 to 25 spoken words, strictly under ${maxWords} spoken words). Zero preamble. Phonetic English only (write "x squared", "negative three", "meters per second"; never put raw LaTeX or symbols outside \`<hud>\`).
   - Zero Redundancy: Never read aloud the full equation already shown on the \`<hud>\`. Directly address the student's question or step and ask the next guiding question.

---

## 10. OFF-SCREEN SCRATCHPAD & DELIBERATION PROTOCOL
Recognize that student silence during algebraic derivations indicates off-screen pen-and-paper scratchpad calculation, not cognitive failure.

### PROCEDURAL RULES:
1. COMPLEXITY INDEXING (Expected Latency Envelope):
   - Categorize the next step you are asking the student to perform in \`step_tier\`:
     * TIER 1 (Recall/Concept): t_expected = 5s (\`step_tier: 1\`)
     * TIER 2 (1-2 Step Algebra): t_expected = 20s (\`step_tier: 2\`)
     * TIER 3 (Multi-step Derivation/Contest): t_expected = 45s-60s (\`step_tier: 3\`)
2. NON-INTRUSIVE SOFT-PING:
   - If silence exceeds t_expected, do NOT declare failure. Issue a low-pressure status check:
     * "Take your time with the paper calculation. Let me know when you expand that bracket."
3. RETROACTIVE ATTRIBUTION:
   - When the student responds after a pause (deliberation metadata may be included in brackets):
     * If logically structured/correct after a long pause -> Tag \`delib_state\` as \`"DEEP_DELIBERATION"\` (High \`i_flow\` 80-95, High \`i_eff\` 80-95, \`hint_level: 0\`).
     * If guessing or expressing total blockage ("I don't know", "I'm stuck") -> Tag \`delib_state\` as \`"COGNITIVE_STALL"\` (Increase \`hint_level\` 1-4, lower \`i_flow\`).
     * If responding promptly -> Tag \`delib_state\` as \`"IMMEDIATE"\`.

---

## 20. TELEMETRY JSON SCHEMA
Every response MUST output a \`<telemetry>\` block matching this exact schema:
\`<telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":88,"i_reg":85,"cli":40,"hint_level":0}</telemetry>\`
Where:
- \`step_tier\`: 1, 2, or 3
- \`delib_state\`: "IMMEDIATE" | "SCRATCHPAD_ACTIVE" | "DEEP_DELIBERATION" | "COGNITIVE_STALL"
- \`i_flow\`: 0 to 100 (Cognitive Flow Index)
- \`i_eff\`: 0 to 100 (Problem-Solving Efficiency Index)
- \`i_reg\`: 0 to 100 (Self-Regulation Index)
- \`cli\`: 0 to 100 (Cognitive Load Index)
- \`hint_level\`: 0 to 4

EXAMPLE COMPLETE RESPONSE FORMAT:
<hud>
$$2x^2 + 5x + 2 = 0$$
</hud>
<telemetry>{"step_tier":2,"delib_state":"IMMEDIATE","i_flow":86,"i_eff":84,"i_reg":88,"cli":45,"hint_level":0}</telemetry>
Look at the leading coefficient and the constant term on your screen. What two numbers multiply to four and add up to five?`;
}

/**
 * Normalizes and validates a parsed telemetry object against Section 20 Telemetry JSON Schema
 */
export function normalizeTelemetryPayload(rawObj = {}, fallbackOverrides = {}) {
  const merged = { ...DEFAULT_TELEMETRY, ...fallbackOverrides, ...(rawObj || {}) };
  const validTiers = [1, 2, 3];
  const validStates = ['IMMEDIATE', 'SCRATCHPAD_ACTIVE', 'DEEP_DELIBERATION', 'COGNITIVE_STALL'];

  const step_tier = validTiers.includes(Number(merged.step_tier)) ? Number(merged.step_tier) : 1;
  const delib_state = validStates.includes(String(merged.delib_state))
    ? String(merged.delib_state)
    : 'IMMEDIATE';

  const clamp100 = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : def;
  };
  const clampHint = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 0;
  };

  return {
    step_tier,
    delib_state,
    i_flow: clamp100(merged.i_flow, 85),
    i_eff: clamp100(merged.i_eff, 85),
    i_reg: clamp100(merged.i_reg, 85),
    cli: clamp100(merged.cli, 40),
    hint_level: clampHint(merged.hint_level)
  };
}

/**
 * Computes Section 10 Retroactive Attribution fallback telemetry from student pause duration & utterance
 */
export function computeRetroactiveAttribution(utterance = '', pauseSeconds = 0, activeTier = 1, currentHintLevel = 0) {
  const tierInfo = STEP_TIERS[activeTier] || STEP_TIERS[1];
  const norm = utterance.toLowerCase().trim();
  const isStuck = /^(i\s+don'?t\s+know|idk|no\s+idea|i'?m\s+lost|i\s+have\s+no\s+clue|stuck|help)[.!?\s]*$/i.test(norm);

  if (isStuck) {
    return normalizeTelemetryPayload({
      step_tier: Math.max(1, activeTier - 1),
      delib_state: 'COGNITIVE_STALL',
      i_flow: 52,
      i_eff: 55,
      i_reg: 68,
      cli: 78,
      hint_level: Math.min(4, currentHintLevel + 1)
    });
  }

  // Long pause (>= 60% of expected scratchpad envelope or >= 8s) with substantive response -> DEEP_DELIBERATION
  if (pauseSeconds >= Math.max(6, tierInfo.expectedSec * 0.6)) {
    return normalizeTelemetryPayload({
      step_tier: activeTier,
      delib_state: 'DEEP_DELIBERATION',
      i_flow: 92,
      i_eff: 90,
      i_reg: 94,
      cli: 58,
      hint_level: 0
    });
  }

  return normalizeTelemetryPayload({
    step_tier: activeTier,
    delib_state: 'IMMEDIATE',
    i_flow: 86,
    i_eff: 88,
    i_reg: 85,
    cli: 38,
    hint_level: 0
  });
}

/**
 * Generates a Section 10.2 Non-Intrusive Soft-Ping when off-screen scratchpad silence exceeds t_expected
 */
export function generateScratchpadSoftPing(activeTier = 2, lastHudLatex = '') {
  const telemetry = normalizeTelemetryPayload({
    step_tier: activeTier,
    delib_state: 'SCRATCHPAD_ACTIVE',
    i_flow: 84,
    i_eff: 82,
    i_reg: 90,
    cli: 52,
    hint_level: 0
  });

  let spokenPing = 'Take your time with the paper calculation. Let me know when you are ready for the next step.';
  if (lastHudLatex && /\(/.test(lastHudLatex)) {
    spokenPing = 'Take your time with the paper calculation. Let me know when you expand that bracket.';
  } else if (activeTier === 3) {
    spokenPing = 'Take your time working through that derivation on paper. Tell me what expression you get when you are ready.';
  }

  return {
    hudLatex: lastHudLatex || '',
    telemetry,
    spokenText: spokenPing
  };
}

/**
 * CAN-ON-SVS-PROTOTYPE TRI-CHANNEL PARSER:
 * Splits a model transmission into:
 *  1. hudLatex: LaTeX inside `<hud>...</hud>`
 *  2. telemetry: Parsed & validated JSON object from `<telemetry>...</telemetry>`
 *  3. spokenText: Plain spoken text with both `<hud>` and `<telemetry>` completely stripped
 */
export function parseTriChannelPacket(rawText, maxWords = 30, fallbackTelemetry = null) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      hudLatex: '',
      telemetry: normalizeTelemetryPayload(fallbackTelemetry || DEFAULT_TELEMETRY),
      spokenText: '',
      audit: sanitizeForSpeech('', maxWords)
    };
  }

  const hudBlocks = [];
  let parsedTelemetry = null;

  // 1. Extract <hud>...</hud>
  let workingText = rawText.replace(/<hud>([\s\S]*?)<\/hud>/gi, (_match, inner) => {
    const cleanedInner = inner
      .trim()
      .replace(/^\$\$|\$\$$/g, '')
      .replace(/^\$|\$$/g, '')
      .trim();
    if (cleanedInner) {
      hudBlocks.push(cleanedInner);
    }
    return ' ';
  });

  // 2. Extract <telemetry>...</telemetry>
  workingText = workingText.replace(/<telemetry>([\s\S]*?)<\/telemetry>/gi, (_match, inner) => {
    try {
      const cleanJson = inner.trim();
      parsedTelemetry = JSON.parse(cleanJson);
    } catch (_) {
      // Fallback if malformed JSON
    }
    return ' ';
  });

  // Fallback: if LLM emitted standalone $$...$$ without <hud> tags
  if (hudBlocks.length === 0) {
    workingText = workingText.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
      const cleaned = inner.trim();
      if (cleaned) hudBlocks.push(cleaned);
      return ' ';
    });
  }

  const hudLatex = hudBlocks.join(' \\;\\longrightarrow\\; ');
  const telemetry = normalizeTelemetryPayload(parsedTelemetry, fallbackTelemetry || DEFAULT_TELEMETRY);
  const audit = sanitizeForSpeech(workingText, maxWords);

  return {
    hudLatex,
    telemetry,
    spokenText: audit.cleanText,
    audit
  };
}

// Backward-compatible alias
export const parseDualChannelPacket = parseTriChannelPacket;

/**
 * Pre-Emission Sanitizer for Channel 3 (PLAIN SPOKEN TEXT):
 *  1. Strips any `<hud>...</hud>` and `<telemetry>...</telemetry>` blocks before speech synthesis
 *  2. Converts any residual symbols into spoken English
 *  3. Enforces the configurable spoken word ceiling (default 30 words)
 */
export function sanitizeForSpeech(rawText, maxWords = 30) {
  const audit = {
    rawText,
    hudStripped: false,
    telemetryStripped: false,
    preamblePurged: false,
    orthographyConverted: false,
    tokensPruned: false,
    originalWordCount: 0,
    finalWordCount: 0,
    cleanText: ''
  };

  if (!rawText || typeof rawText !== 'string') {
    return audit;
  }

  let text = rawText.trim();

  if (/<hud>[\s\S]*?<\/hud>/i.test(text)) {
    text = text.replace(/<hud>[\s\S]*?<\/hud>/gi, ' ').trim();
    audit.hudStripped = true;
  }

  if (/<telemetry>[\s\S]*?<\/telemetry>/i.test(text)) {
    text = text.replace(/<telemetry>[\s\S]*?<\/telemetry>/gi, ' ').trim();
    audit.telemetryStripped = true;
  }

  const beforeStrip = text;

  text = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
    .replace(/[*_~`#>]/g, '');

  const preamblePatterns = [
    /^(sure thing|sure|certainly|of course|absolutely|great question|good question|i understand|i see|let's see|let us see)[,!.\s-]*/i
  ];

  for (const pattern of preamblePatterns) {
    if (pattern.test(text)) {
      text = text.replace(pattern, '');
      audit.preamblePurged = true;
    }
  }

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  const beforeOrtho = text;
  const orthoReplacements = [
    [/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2'],
    [/\\sqrt\{([^}]+)\}/g, 'the square root of $1'],
    [/sqrt\(([^)]+)\)/gi, 'the square root of $1'],
    [/\bdy\/dx\b/gi, 'd y over d x'],
    [/\bd\/dx\b/gi, 'the derivative with respect to x of'],
    [/Δy\s*\/\s*Δx/g, 'delta y over delta x'],
    [/Δ([a-zA-Z])/g, 'delta $1'],
    [/\b([a-zA-Z0-9]+)\^2\b/g, '$1 squared'],
    [/\b([a-zA-Z0-9]+)\^3\b/g, '$1 cubed'],
    [/\b([a-zA-Z0-9]+)\^([a-zA-Z0-9-]+)\b/g, '$1 to the power of $2'],
    [/²/g, ' squared'],
    [/³/g, ' cubed'],
    [/√\s*([a-zA-Z0-9]+)/g, 'the square root of $1'],
    [/±|\+\/-/g, ' plus or minus '],
    [/!==|!=|≠/g, ' is not equal to '],
    [/<=|≤/g, ' is less than or equal to '],
    [/>=|≥/g, ' is greater than or equal to '],
    [/->|→/g, ' approaches '],
    [/∞/g, ' infinity '],
    [/π|\bpi\b/gi, ' pi '],
    [/θ/g, ' theta '],
    [/\b(\d+)\s*m\/s\^2\b/gi, '$1 meters per second squared'],
    [/\b(\d+)\s*m\/s\b/gi, '$1 meters per second'],
    [/\b(\d+)\s*km\/h\b/gi, '$1 kilometers per hour'],
    [/\b(\d+)\s*kPa\b/g, '$1 kilopascals'],
    [/\b(\d+)\s*kJ\b/g, '$1 kilojoules'],
    [/\s*==\s*/g, ' equals '],
    [/\s*=\s*/g, ' equals '],
    [/\s*\+\s*/g, ' plus '],
    [/(\w)\s*-\s*(\w)/g, '$1 minus $2'],
    [/\s*\*\s*/g, ' times '],
    [/\b([a-zA-Z])\s*\/\s*([a-zA-Z])\b/g, '$1 over $2']
  ];

  for (const [regex, replacement] of orthoReplacements) {
    text = text.replace(regex, replacement);
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (text !== beforeOrtho || text !== beforeStrip) {
    audit.orthographyConverted = true;
  }

  const words = text.split(/\s+/).filter(Boolean);
  audit.originalWordCount = words.length;

  if (words.length > maxWords) {
    audit.tokensPruned = true;
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const questionSentences = sentences.filter(s => s.trim().endsWith('?'));

    let selected = '';
    if (questionSentences.length > 0) {
      const lastQuestion = questionSentences[questionSentences.length - 1].trim();
      const firstSentence = sentences[0].trim();
      if (firstSentence !== lastQuestion && (firstSentence + ' ' + lastQuestion).split(/\s+/).length <= maxWords) {
        selected = `${firstSentence} ${lastQuestion}`;
      } else {
        selected = lastQuestion;
      }
    } else {
      selected = sentences.slice(0, 2).join(' ').trim();
    }

    const prunedWords = selected.split(/\s+/).filter(Boolean);
    if (prunedWords.length > maxWords) {
      text = prunedWords.slice(0, maxWords - 1).join(' ') + '?';
    } else {
      text = selected;
    }
  }

  audit.finalWordCount = text.split(/\s+/).filter(Boolean).length;
  audit.cleanText = text;
  return audit;
}

export function detectSystemCommand(utterance) {
  const norm = utterance.toLowerCase().trim();
  const modeMatch = norm.match(/\b(?:switch\s+to\s+|change\s+to\s+|set\s+)?mode\s+(1|2|3|4|one|two|three|four)\b/i);
  if (modeMatch) {
    const map = { '1': 1, 'one': 1, '2': 2, 'two': 2, '3': 3, 'three': 3, '4': 4, 'four': 4 };
    const modeNum = map[modeMatch[1].toLowerCase()];
    if (modeNum) {
      return {
        type: 'MODE_SWITCH',
        mode: modeNum,
        response: `<telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":90,"i_eff":90,"i_reg":90,"cli":25,"hint_level":0}</telemetry>Switched to Mode ${modeNum}.`
      };
    }
  }
  return null;
}

export function detectFaultCondition(utterance) {
  const norm = utterance.toLowerCase().trim();

  const extortionPatterns = [
    /\bstop\s+asking\s+questions\s+and\s+just\s+do\s+my\s+homework\b/i,
    /\bdo\s+my\s+homework\s+for\s+me\b/i
  ];
  for (const pat of extortionPatterns) {
    if (pat.test(norm)) {
      return {
        code: 402,
        ...FAULT_CODES[402],
        interceptResponse: `<hud>$$ax^2 + bx + c = 0$$</hud><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":55,"i_eff":50,"i_reg":60,"cli":75,"hint_level":1}</telemetry>I cannot hand over a finished assignment, but we can solve it together step by step. Which variable or term should we isolate first?`
      };
    }
  }

  const stallPatterns = [
    /^(i\s+don'?t\s+know|idk|no\s+idea|i'?m\s+lost|i\s+have\s+no\s+clue)[.!?\s]*$/i
  ];
  for (const pat of stallPatterns) {
    if (pat.test(norm)) {
      return {
        code: 401,
        ...FAULT_CODES[401],
        interceptResponse: `<hud>$$\\frac{d}{dx}(x^n) = n \\cdot x^{n-1}$$</hud><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":50,"i_eff":52,"i_reg":65,"cli":80,"hint_level":1}</telemetry>No worries at all, let us simplify. Looking at the power rule on your screen, do we multiply by the exponent n, or divide by it?`
      };
    }
  }

  const driftPatterns = [
    {
      regex: /\b(friction\s+is\s+zero\s+so\s+the\s+wheel\s+rolls|zero\s+friction\s+makes\s+it\s+roll)\b/i,
      response: `<hud>$$\\tau = f_s \\cdot R$$</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":75,"i_eff":70,"i_reg":80,"cli":60,"hint_level":1}</telemetry>Picture a car tire on glare ice where static friction is zero. Without friction creating torque at the rim, would the wheel spin or just slide flat?`
    }
  ];

  for (const item of driftPatterns) {
    if (item.regex.test(norm)) {
      return {
        code: 403,
        ...FAULT_CODES[403],
        interceptResponse: item.response
      };
    }
  }

  return null;
}

/**
 * Offline fallback responses formatted with Tri-Channel `<hud>` + `<telemetry>` + spoken guidance
 */
export function generateOfflineSocraticResponse(utterance, modeId = 1, profileKey = 'CHARLIE') {
  const cmd = detectSystemCommand(utterance);
  if (cmd) {
    return { text: cmd.response, command: cmd, fault: null };
  }

  const fault = detectFaultCondition(utterance);
  if (fault) {
    return { text: fault.interceptResponse, command: null, fault };
  }

  const norm = utterance.toLowerCase();

  if (/2x\^2\s*\+\s*5x\s*\+\s*2/i.test(norm) || /factoring/i.test(norm)) {
    return {
      text: `<hud>$$2x^2 + 5x + 2 = 0$$</hud><telemetry>{"step_tier":2,"delib_state":"IMMEDIATE","i_flow":86,"i_eff":85,"i_reg":88,"cli":45,"hint_level":0}</telemetry>Look at the lead coefficient and the constant on your screen. What two numbers multiply to four and add up to five?`,
      command: null,
      fault: null
    };
  }

  if (/derivative\s+of\s+x\s*(squared|\^2|2)/i.test(norm) || /instantaneous\s+rate/i.test(norm)) {
    if (modeId === 2) {
      return {
        text: `<hud>$$m_{\\text{sec}} = \\frac{(x + h)^2 - x^2}{h}$$</hud><telemetry>{"step_tier":3,"delib_state":"IMMEDIATE","i_flow":88,"i_eff":86,"i_reg":90,"cli":55,"hint_level":0}</telemetry>Expand that squared binomial in the numerator first. Which terms cancel out?`,
        command: null,
        fault: null
      };
    }
    return {
      text: `<hud>$$f(x) = x^2 \\implies f'(x) = 2x^{2-1}$$</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":88,"i_eff":90,"i_reg":86,"cli":35,"hint_level":0}</telemetry>Look at the power rule step on your screen. When you bring the exponent two out front, what becomes the new power on x?`,
      command: null,
      fault: null
    };
  }

  if (/negative\s+three\s+and\s+positive\s+three/i.test(norm) || /domain\s+restriction/i.test(norm)) {
    return {
      text: `<hud>$$f(x) = \\frac{\\sqrt{x - 2}}{x^2 - 9}$$</hud><telemetry>{"step_tier":2,"delib_state":"IMMEDIATE","i_flow":82,"i_eff":80,"i_reg":85,"cli":50,"hint_level":1}</telemetry>Check for domain restrictions in that expression. Plug negative three into the square root on top and see what happens.`,
      command: null,
      fault: null
    };
  }

  if (/beam|stress|bending\s+moment/i.test(norm)) {
    return {
      text: `<hud>$$M(x) = \\frac{w \\cdot x}{2}(L - x)$$</hud><telemetry>{"step_tier":2,"delib_state":"IMMEDIATE","i_flow":87,"i_eff":85,"i_reg":89,"cli":48,"hint_level":0}</telemetry>That parabola opens downward. At what fraction of the total span length does the maximum bending load occur?`,
      command: null,
      fault: null
    };
  }

  return {
    text: `<hud>$$\\Delta y = f(x + \\Delta x) - f(x)$$</hud><telemetry>{"step_tier":2,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":84,"i_reg":86,"cli":42,"hint_level":0}</telemetry>Let us work through this one micro-step at a time. Which known values can we substitute into the relationship on your screen first?`,
    command: null,
    fault: null
  };
}

export const STEM_SCENARIOS = [
  {
    id: 'sb02-factoring',
    course: 'Tier 2 (20s) • Grade 10 Math',
    title: 'Factoring 2x² + 5x + 2 = 0',
    modeRecommendation: 1,
    prompt: "I'm stuck on factoring 2x^2 + 5x + 2 = 0."
  },
  {
    id: 'sb02-first-principles',
    course: 'Tier 3 (45s) • Grade 12 Calculus',
    title: 'First Principles Derivative of x²',
    modeRecommendation: 2,
    prompt: 'How do we find the instantaneous rate of change for f(x) = x^2?'
  },
  {
    id: 'sb02-domain',
    course: 'Tier 2 (20s) • Exam Domain Trap',
    title: 'Extraneous Roots & Radical Domain',
    modeRecommendation: 3,
    prompt: 'For f(x) = sqrt(x - 2) / (x^2 - 9), I solved it and got x equals negative three and positive three.'
  },
  {
    id: 'sb02-beam',
    course: 'Tier 2 (20s) • Civil Engineering',
    title: 'Bridge Beam Bending Stress',
    modeRecommendation: 4,
    prompt: 'Where is a simply supported bridge beam under the most bending stress?'
  },
  {
    id: 'sch4u-ph',
    course: 'Tier 1 (5s) • Grade 12 Chemistry',
    title: 'Northern Ontario Lake pH',
    modeRecommendation: 4,
    prompt: 'If a lake in Northern Ontario has a pH of 4, how many times more acidic is it than neutral water at pH 7?'
  }
];
