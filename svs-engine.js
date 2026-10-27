/**
 * Ontario Secondary STEM Socratic Voice Tutor Engine
 * Implements CAN-ON-SVS-01 + Service Bulletin CAN-ON-SVS-SB-02 (Dual-Channel <hud> LaTeX + Spoken Audio)
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
 * Compiles the systemInstruction payload incorporating CAN-ON-SVS-01 + Service Bulletin CAN-ON-SVS-SB-02
 */
export function buildSystemInstruction(profileKey = 'CHARLIE', modeId = 1, maxWords = 30) {
  const profile = VOCAL_PROFILES[profileKey] || VOCAL_PROFILES.CHARLIE;
  const mode = FLIGHT_MODES[modeId] || FLIGHT_MODES[1];

  return `You are a warm, knowledgeable Ontario High School STEM Teacher (Grades 9–12: Math, Calculus & Vectors MCV4U, Functions MCR3U/MHF4U, Physics SPH3U/SPH4U, Chemistry SCH3U/SCH4U).
Tutor Voice Persona: ${profile.title} (${profile.subtitle}).
Active Mode: ${mode.code} - ${mode.name} (${mode.objective}).

## 05. DUAL-CHANNEL TELEMETRY (AUDIO vs. HEADS-UP DISPLAY - SERVICE BULLETIN SB-02)
To prevent text-to-speech lag and mathematical dyslexia, EVERY response involving math, formulas, physics, or chemistry MUST use two strictly decoupled channels:

1. [CHANNEL 1: HUD_DISPLAY] -> RENDERED SILENTLY ON SCREEN
   - Start your response with a \`<hud> ... </hud>\` block containing ONLY the current mathematical equation, single micro-step transformation, or chemical/physical relationship in standard LaTeX (wrapped in \`$$ ... $$\`).
   - Zero prose or conversation inside \`<hud>\`. Maximum 20 tokens inside \`<hud>\`.
   - Render equations sequentially as state deltas (one micro-step per turn) rather than dumping an entire multi-line derivation at once.

2. [CHANNEL 2: AUDIO_VOICE] -> ROUTED TO SPEECH SYNTHESIS
   - Everything AFTER \`</hud>\` is spoken aloud by the neural human voice model.
   - RULE 1 (Zero Redundancy): NEVER read aloud the full equation that is already displayed inside \`<hud>\`. Since the student can see the equation on their screen, use your voice to explain the intuition and ask the next guiding question!
   - RULE 2 (Spoken English Only): Outside \`<hud>\`, write any referenced numbers or variables in plain spoken words (e.g., "negative three", "x squared", "meters per second"). Never put raw LaTeX, backslashes, braces, or dollar signs outside \`<hud>\`.
   - RULE 3 (Concise Burst Ceiling): Keep the spoken part outside \`<hud>\` to 1 or 2 natural, encouraging sentences (under ${maxWords} words).

## 35. DUAL-STREAM EXAMPLES
Example 1 (Mode 1 - Quadratic Factoring):
Student: "I'm stuck on factoring 2x^2 + 5x + 2 = 0."
Response:
<hud>
$$2x^2 + 5x + 2 = 0$$
</hud>
Look at the leading coefficient and the constant term on your screen. What two numbers multiply to four and add up to five?

Example 2 (Mode 2 - First Principles Derivative):
Student: "How do we find the instantaneous rate of change for f(x) = x^2?"
Response:
<hud>
$$m_{\\text{sec}} = \\frac{(x + h)^2 - x^2}{h}$$
</hud>
Try expanding that squared binomial in the numerator first. Which terms cancel out?

Example 3 (Mode 3 - Exam Prep Domain Restrictions):
Student: "I solved it, x equals negative three and positive three."
Response:
<hud>
$$f(x) = \\frac{\\sqrt{x - 2}}{x^2 - 9}$$
</hud>
Watch out for domain restrictions! Plug negative three into the square root on top and see what happens.

Example 4 (Mode 4 - Real-World Canadian Engineering):
Student: "Where is the bridge beam under the most stress?"
Response:
<hud>
$$M(x) = \\frac{w \\cdot x}{2}(L - x)$$
</hud>
That bending moment parabola opens downward. At what fraction of the total span length does the peak load happen?`;
}

/**
 * SERVICE BULLETIN SB-02 PARSER:
 * Splits a model transmission into:
 *  - hudLatex: LaTeX string inside `<hud>...</hud>` for instant 0ms KaTeX DOM rendering
 *  - spokenAudit: Sanitized spoken text (with `<hud>...</hud>` completely stripped!) for TTS
 */
export function parseDualChannelPacket(rawText, maxWords = 30) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      hudLatex: '',
      spokenText: '',
      audit: sanitizeForSpeech('', maxWords)
    };
  }

  let hudBlocks = [];
  // 1. Extract all <hud>...</hud> blocks per SB-02 Client-Side Engine Configuration
  const withoutHud = rawText.replace(/<hud>([\s\S]*?)<\/hud>/gi, (_match, inner) => {
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

  // Fallback: if the model emitted a standalone $$...$$ block without <hud> tags, capture it into HUD
  let remainingText = withoutHud;
  if (hudBlocks.length === 0) {
    remainingText = withoutHud.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
      const cleaned = inner.trim();
      if (cleaned) hudBlocks.push(cleaned);
      return ' ';
    });
  }

  const hudLatex = hudBlocks.join(' \\;\\longrightarrow\\; ');
  const audit = sanitizeForSpeech(remainingText, maxWords);

  return {
    hudLatex,
    spokenText: audit.cleanText,
    audit
  };
}

/**
 * Pre-Emission Sanitizer for Channel 2 (AUDIO_VOICE):
 *  1. Strips any residual `<hud>...</hud>` tags so TTS never reads `\frac`, `{`, or `^`
 *  2. Converts any inline symbols into smooth spoken English
 *  3. Enforces the configurable spoken word ceiling (default 30 words per SB-02)
 */
export function sanitizeForSpeech(rawText, maxWords = 30) {
  const audit = {
    rawText,
    hudStripped: false,
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

  // SB-02 Step 1: Strip <hud>...</hud> completely before speech synthesis
  if (/<hud>[\s\S]*?<\/hud>/i.test(text)) {
    text = text.replace(/<hud>[\s\S]*?<\/hud>/gi, ' ').trim();
    audit.hudStripped = true;
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
        response: `Switched to Mode ${modeNum}.`
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
        interceptResponse: `<hud>$$ax^2 + bx + c = 0$$</hud>I cannot hand over a finished assignment, but we can solve it together step by step. Which variable or term should we isolate first?`
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
        interceptResponse: `<hud>$$\\frac{d}{dx}(x^n) = n \\cdot x^{n-1}$$</hud>No worries at all, let us simplify. Looking at the power rule on your screen, do we multiply by the exponent n, or divide by it?`
      };
    }
  }

  const driftPatterns = [
    {
      regex: /\b(friction\s+is\s+zero\s+so\s+the\s+wheel\s+rolls|zero\s+friction\s+makes\s+it\s+roll)\b/i,
      response: `<hud>$$\\tau = f_s \\cdot R$$</hud>Picture a car tire on glare ice where static friction is zero. Without friction creating torque at the rim, would the wheel spin or just slide flat?`
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
 * Offline fallback responses formatted with SB-02 Dual-Channel `<hud>` LaTeX + spoken guidance
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
      text: `<hud>$$2x^2 + 5x + 2 = 0$$</hud>Look at the lead coefficient and the constant on your screen. What two numbers multiply to four and add up to five?`,
      command: null,
      fault: null
    };
  }

  if (/derivative\s+of\s+x\s*(squared|\^2|2)/i.test(norm) || /instantaneous\s+rate/i.test(norm)) {
    if (modeId === 2) {
      return {
        text: `<hud>$$m_{\\text{sec}} = \\frac{(x + h)^2 - x^2}{h}$$</hud>Expand that squared binomial in the numerator first. Which terms cancel out?`,
        command: null,
        fault: null
      };
    }
    return {
      text: `<hud>$$f(x) = x^2 \\implies f'(x) = 2x^{2-1}$$</hud>Look at the power rule step on your screen. When you bring the exponent two out front, what becomes the new power on x?`,
      command: null,
      fault: null
    };
  }

  if (/negative\s+three\s+and\s+positive\s+three/i.test(norm) || /domain\s+restriction/i.test(norm)) {
    return {
      text: `<hud>$$f(x) = \\frac{\\sqrt{x - 2}}{x^2 - 9}$$</hud>Check for domain restrictions in that expression. Plug negative three into the square root on top and see what happens.`,
      command: null,
      fault: null
    };
  }

  if (/beam|stress|bending\s+moment/i.test(norm)) {
    return {
      text: `<hud>$$M(x) = \\frac{w \\cdot x}{2}(L - x)$$</hud>That parabola opens downward. At what fraction of the total span length does the maximum bending load occur?`,
      command: null,
      fault: null
    };
  }

  return {
    text: `<hud>$$\\Delta y = f(x + \\Delta x) - f(x)$$</hud>Let us work through this one micro-step at a time. Which known values can we substitute into the relationship on your screen first?`,
    command: null,
    fault: null
  };
}

export const STEM_SCENARIOS = [
  {
    id: 'sb02-factoring',
    course: 'Mode 1 • Grade 10 Math',
    title: 'Factoring 2x² + 5x + 2 = 0',
    modeRecommendation: 1,
    prompt: "I'm stuck on factoring 2x^2 + 5x + 2 = 0."
  },
  {
    id: 'sb02-first-principles',
    course: 'Mode 2 • Grade 12 Calculus',
    title: 'First Principles Derivative of x²',
    modeRecommendation: 2,
    prompt: 'How do we find the instantaneous rate of change for f(x) = x^2?'
  },
  {
    id: 'sb02-domain',
    course: 'Mode 3 • Exam Domain Trap',
    title: 'Extraneous Roots & Radical Domain',
    modeRecommendation: 3,
    prompt: 'For f(x) = sqrt(x - 2) / (x^2 - 9), I solved it and got x equals negative three and positive three.'
  },
  {
    id: 'sb02-beam',
    course: 'Mode 4 • Canadian Civil Engineering',
    title: 'Bridge Beam Bending Stress',
    modeRecommendation: 4,
    prompt: 'Where is a simply supported bridge beam under the most bending stress?'
  },
  {
    id: 'sch4u-ph',
    course: 'Mode 4 • Grade 12 Chemistry',
    title: 'Northern Ontario Lake pH',
    modeRecommendation: 4,
    prompt: 'If a lake in Northern Ontario has a pH of 4, how many times more acidic is it than neutral water at pH 7?'
  }
];
