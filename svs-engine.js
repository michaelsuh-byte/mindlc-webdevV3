/**
 * Ontario Secondary STEM Socratic Voice Tutor Engine
 * Implements:
 *  - CAN-ON-SVS-01 Core Socratic Voice System
 *  - Service Bulletin CAN-ON-SVS-SB-02 (<hud> Visual LaTeX Stepping + Strict LaTeX Screening Layer)
 *  - CAN-ON-SVS-PROTOTYPE Multi-Channel Decoupling (<hud>, <graph>, <telemetry>, Spoken Audio)
 *  - Section 10: Deliberation Protocol & Context-Aware Varied Check-Ins
 *  - Section 20: Telemetry JSON Schema (including `session_complete` for Manim Video Offer)
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
  1: { tier: 1, name: 'TIER 1 (Recall / Concept)', expectedSec: 15 },
  2: { tier: 2, name: 'TIER 2 (1–2 Step Algebra)', expectedSec: 25 },
  3: { tier: 3, name: 'TIER 3 (Multi-Step Derivation)', expectedSec: 45 }
};

export const DEFAULT_TELEMETRY = {
  step_tier: 1,
  delib_state: 'IMMEDIATE',
  i_flow: 85,
  i_eff: 85,
  i_reg: 85,
  cli: 35,
  hint_level: 0,
  session_complete: false
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
 * STRICT LATEX SCREENING LAYER (`sanitizeLatexForHud`):
 * Guarantees that NO raw `$` or `$$` or `\[` or `\(` delimiters or markdown fences
 * ever enter `katex.render()`, preventing KaTeX from failing or displaying literal `$` signs.
 */
export function sanitizeLatexForHud(rawInput = '') {
  if (!rawInput || typeof rawInput !== 'string') return '';

  let cleaned = rawInput
    .replace(/<\/?hud>/gi, ' ')
    .replace(/<\/?telemetry>/gi, ' ')
    .replace(/<\/?graph>/gi, ' ')
    .replace(/```(?:latex|math)?/gi, ' ')
    .replace(/```/g, ' ')
    .trim();

  cleaned = cleaned
    .replace(/\\\[|\\\]|\\\(|\\\)/g, ' ')
    .replace(/\$\$\s*\$\$/g, ' \\quad ')
    .replace(/\$\s*,\s*\$/g, ', \\; ')
    .replace(/\$\s+(?:and|or)\s+\$/gi, ' \\;\\text{and}\\; ')
    .replace(/\\\$/g, '')
    .replace(/\$/g, '')
    .trim();

  cleaned = cleaned
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(' \\quad ');

  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Compiles the full systemInstruction payload including `<hud>`, `<graph>`, `<telemetry>`, and Session-End Manim Offer
 */
export function buildSystemInstruction(profileKey = 'CHARLIE', modeId = 1, maxWords = 30) {
  const profile = VOCAL_PROFILES[profileKey] || VOCAL_PROFILES.CHARLIE;
  const mode = FLIGHT_MODES[modeId] || FLIGHT_MODES[1];

  return `You are a warm, knowledgeable Ontario High School STEM Teacher (Grades 9–12: Math, Calculus & Vectors MCV4U, Functions MCR3U/MHF4U, Physics SPH3U/SPH4U, Chemistry SCH3U/SCH4U).
Tutor Voice Persona: ${profile.title} (${profile.subtitle}).
Active Mode: ${mode.code} - ${mode.name} (${mode.objective}).

# [SYSTEM SPECIFICATION: FLIGHT OPERATIONS MANUAL - CAN-ON-SVS-PROTOTYPE]

## 00. OPERATIONAL DIRECTIVES & MULTI-CHANNEL DECOUPLING
The system operates simultaneously across decoupled communication channels in a single response stream:

1. \`<hud> ... </hud>\` (STUDENT MATH DISPLAY):
   - Contains ONLY a single clean LaTeX math expression representing the current mathematical state or micro-step delta.
   - IMPORTANT LATEX RULE: Write pure LaTeX inside \`<hud> ... </hud>\` WITHOUT any \`$\` or \`$$\` dollar signs! (Example: \`<hud>2x^2 + 5x + 2 = 0</hud>\`).
2. \`<graph> ... </graph>\` (INTERACTIVE GRAPHING CALCULATOR):
   - Whenever the student asks to see a graph, plot, curve, parabola, tangent, vertex, intercept, or visual representation of a function, you MUST emit a \`<graph>\` block containing a single-line JSON specification so the interactive graph renders directly in the chat!
   - Format: \`<graph>{"functions":["2*x^2 + 5*x + 2"],"title":"Graph of f(x) = 2x^2 + 5x + 2","xDomain":[-6,4],"yDomain":[-4,10]}</graph>\`
   - Do NOT try to just describe a graph verbally when asked for a graph—always emit the \`<graph>\` tag and briefly point out a key feature on the plotted graph!
2b. \`<table_data> ... </table_data>\` (OPTIONAL STRUCTURED SUMMARY TABLE):
   - When comparing coefficients, factor pairs, domain intervals, sign charts, or key equation properties, you may emit a concise single-line JSON table to enhance visual legibility:
     \`<table_data>{"headers":["Parameter","Value","Meaning"],"rows":[["a","2","Leading coefficient"],["b","5","Linear coefficient"],["c","2","Constant term"]]}</table_data>\`
3. \`<telemetry> ... </telemetry>\` (BACKEND DASHBOARD / METRIC ENGINE):
   - Emits a single-line minified JSON payload:
     \`<telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":88,"i_reg":85,"cli":40,"hint_level":0,"session_complete":false}</telemetry>\`
   - Set \`"session_complete": true\` ONLY when the student has reached the final answer or finished solving/understanding the problem!
4. [PLAIN SPOKEN TEXT] (AUDIO SYNTHESIZER):
   - Everything outside \`<hud>\`, \`<graph>\`, \`<table_data>\`, and \`<telemetry>\` tags is routed to the voice emitter.
   - Strict 1–2 sentence limit (aim for 15 to 25 spoken words, strictly under ${maxWords} spoken words). Zero preamble.
   - NEVER use \`$\` signs or LaTeX commands in the spoken text.
   - END-OF-SESSION SOLUTION VIDEO OFFER: When the student finishes solving the problem (\`"session_complete": true\`), congratulate them briefly and ask: "Would you like to watch a full step-by-step solution video with voice explanation for this question?" (Never mention the word "Manim" or internal engine names).`;
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
    hint_level: clampHint(merged.hint_level),
    session_complete: Boolean(merged.session_complete)
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

  if (pauseSeconds >= Math.max(8, tierInfo.expectedSec * 0.6)) {
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

let lastCheckInIndex = -1;

export function generateContextualCheckIn({
  activeTier = 1,
  lastHudLatex = '',
  lastTutorQuestion = ''
} = {}) {
  const telemetry = normalizeTelemetryPayload({
    step_tier: activeTier,
    delib_state: 'SCRATCHPAD_ACTIVE',
    i_flow: 84,
    i_eff: 82,
    i_reg: 90,
    cli: 52,
    hint_level: 0
  });

  const qNorm = (lastTutorQuestion || '').toLowerCase();
  const candidates = [];

  if (/multiply|add\s+up|factor/i.test(qNorm)) {
    candidates.push(
      'Take your time thinking through the factor pairs—let me know if you want to test a couple of numbers together.',
      'No rush! Whenever a pair of numbers comes to mind, share them and we can check if they work.'
    );
  } else if (/cancel|expand|numerator|denominator|simplify/i.test(qNorm)) {
    candidates.push(
      'Take a moment to look over those terms—tell me when you spot which ones cancel, or ask if you want a hint.',
      'Whether you are working it out in your head or jotting it down, let me know what you get for that expression.'
    );
  } else if (/domain|restriction|negative|square\s+root|radical|zero/i.test(qNorm)) {
    candidates.push(
      'Take a second to think about what happens inside that expression—what do you notice when you plug that value in?',
      'No rush—think about whether that number gives a valid real output, or let me know if you want a quick clue.'
    );
  } else if (/why|concept|how\s+does|what\s+happens|increase|decrease|slope|velocity|ph|acid/i.test(qNorm)) {
    candidates.push(
      'Take a moment to think through the idea—feel free to share your first hunch, even if you are not a hundred percent sure.',
      'No pressure at all! Let me know what your intuition tells you, or ask if you would like me to rephrase the question.'
    );
  }

  if (activeTier === 1) {
    candidates.push(
      'Take your time thinking about it—share whatever comes to mind first, or let me know if you want a small hint.',
      'Whenever you are ready! If that question feels tricky, just say the word and we can look at it from an easier angle.'
    );
  } else if (activeTier === 2) {
    candidates.push(
      'No rush—whether you are thinking through the step mentally or working it out, let me know when you are ready.',
      'Take all the time you need on this step, and tell me if you would like a quick nudge to get started.'
    );
  } else {
    candidates.push(
      'This step has a few moving parts, so take your time—let me know what you come up with or if you want to break it down smaller.',
      'Take your time thinking or working through that step, and just chime in whenever you are ready.'
    );
  }

  const idx = (lastCheckInIndex + 1) % candidates.length;
  lastCheckInIndex = idx;

  return {
    hudLatex: sanitizeLatexForHud(lastHudLatex || ''),
    telemetry,
    spokenText: candidates[idx]
  };
}

export function generateScratchpadSoftPing(activeTier = 2, lastHudLatex = '', lastTutorQuestion = '') {
  return generateContextualCheckIn({ activeTier, lastHudLatex, lastTutorQuestion });
}

/**
 * Checks if the user's message is asking to see or plot a graph
 */
export function isGraphRequestedByUser(utterance = '') {
  return /\b(graph|plot|sketch|curve|parabola|draw|visuali[sz]e|show\s+me\s+what\s+it\s+looks\s+like)\b/i.test(utterance);
}

/**
 * Extracts a plottable function expression from a LaTeX HUD string or user utterance
 * when the user asks for a graph.
 */
export function buildFallbackGraphSpec(hudLatex = '', utterance = '') {
  const candidates = [];

  // Look for explicit expression in user utterance first (e.g., "graph y = x^2 - 4" or "plot sin(x)")
  const userExprMatch = utterance.match(/(?:y\s*=\s*|f\(x\)\s*=\s*|graph\s+of\s+|graph\s+|plot\s+)([0-9a-zA-Z^+\-*/().\s\\]+)/i);
  if (userExprMatch && userExprMatch[1]) {
    const cleaned = userExprMatch[1]
      .replace(/\b(please|for\s+me|now|in\s+the\s+chat)\b/gi, '')
      .trim();
    if (cleaned && /[x\d]/i.test(cleaned)) {
      candidates.push(cleaned);
    }
  }

  if (candidates.length === 0 && hudLatex) {
    // Split across \implies or \quad and take a plottable expression containing x
    const parts = hudLatex.split(/\\implies|\\quad|;/);
    for (const part of parts) {
      if (/x/i.test(part) && !/\\Delta\s*y/i.test(part)) {
        candidates.push(part.trim());
        break;
      }
    }
  }

  const expr = candidates[0] || '2*x^2 + 5*x + 2';
  return {
    functions: [expr],
    title: `Interactive Graph: ${expr}`,
    xDomain: [-8, 8],
    yDomain: [-6, 10]
  };
}

/**
 * Detects whether a student's reply to the End-of-Session Manim Video prompt is YES or NO
 */
export function detectManimConsentIntent(utterance = '') {
  const norm = utterance.toLowerCase().trim();
  if (/^(yes|yeah|yep|yup|sure|ok|okay|please|go\s+ahead|make\s+(the\s+)?video|show\s+(me\s+)?(the\s+)?video|yes\s+please|i\s+would\s+like\s+that|sounds\s+good)\b/i.test(norm)) {
    return 'YES';
  }
  if (/^(no|nope|nah|no\s+thanks|no\s+thank\s+you|skip|not\s+right\s+now|don'?t\s+make|pass)\b/i.test(norm)) {
    return 'NO';
  }
  return null;
}

/**
 * MULTI-CHANNEL PARSER (`<hud>`, `<graph>`, `<telemetry>`, and Plain Spoken Audio)
 */
export function parseTriChannelPacket(rawText, maxWords = 30, fallbackTelemetry = null) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      hudLatex: '',
      graphSpec: null,
      telemetry: normalizeTelemetryPayload(fallbackTelemetry || DEFAULT_TELEMETRY),
      spokenText: '',
      audit: sanitizeForSpeech('', maxWords)
    };
  }

  const hudBlocks = [];
  let parsedTelemetry = null;
  let parsedGraph = null;
  let parsedTable = null;

  // 1. Extract <hud>...</hud>
  let workingText = rawText.replace(/<hud>([\s\S]*?)<\/hud>/gi, (_match, inner) => {
    const cleanedInner = sanitizeLatexForHud(inner);
    if (cleanedInner) {
      hudBlocks.push(cleanedInner);
    }
    return ' ';
  });

  // 2. Extract <graph>...</graph>
  workingText = workingText.replace(/<graph>([\s\S]*?)<\/graph>/gi, (_match, inner) => {
    const rawInner = inner.trim();
    try {
      parsedGraph = JSON.parse(rawInner);
    } catch (_) {
      if (rawInner) {
        parsedGraph = {
          functions: [rawInner.replace(/^\$\$|\$\$$/g, '').replace(/\$/g, '').trim()],
          title: `Function Graph`,
          xDomain: [-8, 8],
          yDomain: [-6, 10]
        };
      }
    }
    return ' ';
  });

  // 2b. Extract <table_data>...</table_data>
  workingText = workingText.replace(/<table_data>([\s\S]*?)<\/table_data>/gi, (_match, inner) => {
    try {
      const parsed = JSON.parse(inner.trim());
      if (parsed && Array.isArray(parsed.headers) && Array.isArray(parsed.rows)) {
        parsedTable = parsed;
      }
    } catch (_) {}
    return ' ';
  });

  // 3. Extract <telemetry>...</telemetry>
  workingText = workingText.replace(/<telemetry>([\s\S]*?)<\/telemetry>/gi, (_match, inner) => {
    try {
      const cleanJson = inner.trim();
      parsedTelemetry = JSON.parse(cleanJson);
    } catch (_) {}
    return ' ';
  });

  // 4. Fallback: if LLM emitted standalone $$...$$ outside <hud>
  workingText = workingText.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
    const cleaned = sanitizeLatexForHud(inner);
    if (cleaned && hudBlocks.length === 0) {
      hudBlocks.push(cleaned);
    }
    return ' ';
  });

  const hudLatex = sanitizeLatexForHud(hudBlocks.join(' \\quad '));
  const telemetry = normalizeTelemetryPayload(parsedTelemetry, fallbackTelemetry || DEFAULT_TELEMETRY);
  const audit = sanitizeForSpeech(workingText, maxWords);

  // Also detect if spoken text explicitly offers the step-by-step solution video
  if (/\b(solution\s+video|instructional\s+video|step-by-step\s+video|watch\s+a\s+full)\b/i.test(audit.cleanText)) {
    telemetry.session_complete = true;
  }

  return {
    hudLatex,
    graphSpec: parsedGraph,
    tableSpec: parsedTable,
    telemetry,
    spokenText: audit.cleanText,
    audit
  };
}

export const parseDualChannelPacket = parseTriChannelPacket;

/**
 * Pre-Emission Sanitizer for Plain Spoken Audio Channel
 */
export function sanitizeForSpeech(rawText, maxWords = 30) {
  const audit = {
    rawText,
    hudStripped: false,
    graphStripped: false,
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

  if (/<graph>[\s\S]*?<\/graph>/i.test(text)) {
    text = text.replace(/<graph>[\s\S]*?<\/graph>/gi, ' ').trim();
    audit.graphStripped = true;
  }

  if (/<table_data>[\s\S]*?<\/table_data>/i.test(text)) {
    text = text.replace(/<table_data>[\s\S]*?<\/table_data>/gi, ' ').trim();
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
    .replace(/\\\$/g, '')
    .replace(/\$/g, '')
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
        response: `<telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":90,"i_eff":90,"i_reg":90,"cli":25,"hint_level":0,"session_complete":false}</telemetry>Switched to Mode ${modeNum}.`
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
        interceptResponse: `<hud>ax^2 + bx + c = 0</hud><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":55,"i_eff":50,"i_reg":60,"cli":75,"hint_level":1,"session_complete":false}</telemetry>I cannot hand over a finished assignment, but we can solve it together step by step. Which variable or term should we isolate first?`
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
        interceptResponse: `<hud>\\frac{d}{dx}(x^n) = n \\cdot x^{n-1}</hud><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":50,"i_eff":52,"i_reg":65,"cli":80,"hint_level":1,"session_complete":false}</telemetry>No worries at all, let us simplify. Looking at the power rule on your screen, do we multiply by the exponent n, or divide by it?`
      };
    }
  }

  const driftPatterns = [
    {
      regex: /\b(friction\s+is\s+zero\s+so\s+the\s+wheel\s+rolls|zero\s+friction\s+makes\s+it\s+roll)\b/i,
      response: `<hud>\\tau = f_s \\cdot R</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":75,"i_eff":70,"i_reg":80,"cli":60,"hint_level":1,"session_complete":false}</telemetry>Picture a car tire on glare ice where static friction is zero. Without friction creating torque at the rim, would the wheel spin or just slide flat?`
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

export function generateOfflineSocraticResponse(utterance, modeId = 1, _profileKey = 'CHARLIE') {
  const cmd = detectSystemCommand(utterance);
  if (cmd) {
    return { text: cmd.response, command: cmd, fault: null };
  }

  const fault = detectFaultCondition(utterance);
  if (fault) {
    return { text: fault.interceptResponse, command: null, fault };
  }

  const norm = utterance.toLowerCase();

  if (isGraphRequestedByUser(norm)) {
    const spec = buildFallbackGraphSpec('', utterance);
    return {
      text: `<hud>${spec.functions[0]}</hud><graph>${JSON.stringify(spec)}</graph><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":90,"i_eff":90,"i_reg":88,"cli":35,"hint_level":0,"session_complete":false}</telemetry>Here is the interactive graph of the function. Hover over the curve to inspect its intercepts and vertex—what do you notice about where it crosses the x axis?`,
      command: null,
      fault: null
    };
  }

  if (/2x\^2\s*\+\s*5x\s*\+\s*2/i.test(norm) || /factoring/i.test(norm)) {
    return {
      text: `<hud>2x^2 + 5x + 2 = 0</hud><telemetry>{"step_tier":2,"delib_state":"IMMEDIATE","i_flow":86,"i_eff":85,"i_reg":88,"cli":45,"hint_level":0,"session_complete":false}</telemetry>Look at the lead coefficient and the constant on your screen. What two numbers multiply to four and add up to five?`,
      command: null,
      fault: null
    };
  }

  if (/derivative\s+of\s+x\s*(squared|\^2|2)/i.test(norm) || /instantaneous\s+rate/i.test(norm)) {
    if (modeId === 2) {
      return {
        text: `<hud>m_{\\text{sec}} = \\frac{(x + h)^2 - x^2}{h}</hud><telemetry>{"step_tier":3,"delib_state":"IMMEDIATE","i_flow":88,"i_eff":86,"i_reg":90,"cli":55,"hint_level":0,"session_complete":false}</telemetry>Expand that squared binomial in the numerator first. Which terms cancel out?`,
        command: null,
        fault: null
      };
    }
    return {
      text: `<hud>f(x) = x^2 \\implies f'(x) = 2x^{2-1}</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":88,"i_eff":90,"i_reg":86,"cli":35,"hint_level":0,"session_complete":false}</telemetry>Look at the power rule step on your screen. When you bring the exponent two out front, what becomes the new power on x?`,
      command: null,
      fault: null
    };
  }

  return {
    text: `<hud>\\Delta y = f(x + \\Delta x) - f(x)</hud><telemetry>{"step_tier":2,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":84,"i_reg":86,"cli":42,"hint_level":0,"session_complete":false}</telemetry>Let us work through this one micro-step at a time. Which known values can we substitute into the relationship on your screen first?`,
    command: null,
    fault: null
  };
}

export const STEM_SCENARIOS = [
  {
    id: 'graph-parabola',
    course: 'Interactive Graph • Grade 11 Functions',
    title: '📈 Graph & Inspect 2x² + 5x + 2',
    modeRecommendation: 1,
    prompt: 'Can you show me the graph of y = 2x^2 + 5x + 2 and help me find its roots and vertex?'
  },
  {
    id: 'sb02-factoring',
    course: 'Tier 2 • Grade 10 Math',
    title: 'Factoring 2x² + 5x + 2 = 0',
    modeRecommendation: 1,
    prompt: "I'm stuck on factoring 2x^2 + 5x + 2 = 0."
  },
  {
    id: 'sb02-first-principles',
    course: 'Tier 3 • Grade 12 Calculus',
    title: 'First Principles Derivative of x²',
    modeRecommendation: 2,
    prompt: 'How do we find the instantaneous rate of change for f(x) = x^2?'
  },
  {
    id: 'sb02-domain',
    course: 'Tier 2 • Exam Domain Trap',
    title: 'Extraneous Roots & Radical Domain',
    modeRecommendation: 3,
    prompt: 'For f(x) = sqrt(x - 2) / (x^2 - 9), I solved it and got x equals negative three and positive three.'
  },
  {
    id: 'sb02-beam',
    course: 'Tier 2 • Civil Engineering',
    title: 'Bridge Beam Bending Stress',
    modeRecommendation: 4,
    prompt: 'Where is a simply supported bridge beam under the most bending stress?'
  }
];
