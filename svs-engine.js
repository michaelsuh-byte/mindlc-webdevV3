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
  1: { tier: 1, name: 'TIER 1 (Recall / Concept)', expectedSec: 12 },
  2: { tier: 2, name: 'TIER 2 (1–2 Step Algebra)', expectedSec: 15 },
  3: { tier: 3, name: 'TIER 3 (Multi-Step Derivation)', expectedSec: 20 }
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
    sublabel: 'Micro-Diagnostic + Step-by-Step Inquiry',
    objective: 'Calibrate the student’s conceptual baseline first (max 2 low-stakes probes in plain everyday English), abort immediately to a foundational bridge on any stall, and guide one micro-step delta at a time.',
    diagnosticFocus: 'Ask a simple, everyday-language question about what the equation or target quantity means (for example, what happens to the height on a graph when an equation equals zero, or what the bottom number of a fraction means) before doing any calculation.',
    progressionRule: 'Once calibrated (or bridged via the Safety Net), guide the step-by-step transformation one clear piece at a time using plain, accessible language.'
  },
  2: {
    id: 2,
    code: 'Mode 2',
    name: 'First Principles',
    sublabel: 'Intuition Probe + Axiom Derivation',
    objective: 'Probe everyday geometric or physical intuition first, then build formulas from the ground up one small step at a time.',
    diagnosticFocus: 'Ask an easy, concrete question about how fast something changes between two points or how two quantities balance before introducing formal notation.',
    progressionRule: 'Bridge from everyday geometric or physical intuition directly into the step-by-step derivation one clear step per turn.'
  },
  3: {
    id: 3,
    code: 'Mode 3',
    name: 'Exam Practice',
    sublabel: 'Domain Radar + Ontario Rubric Check',
    objective: 'Check awareness of allowed numbers (domain restrictions), impossible division by zero, and unit traps before solving or verifying Ontario curriculum problems.',
    diagnosticFocus: 'Ask in plain English whether any numbers are not allowed in the expression (like dividing by zero or taking the square root of a negative number) before crunching numbers.',
    progressionRule: 'Test candidate solutions against allowed-number rules and guide full Ontario rubric verification step by step.'
  },
  4: {
    id: 4,
    code: 'Mode 4',
    name: 'Real-World Canada',
    sublabel: 'Physical Calibration + STEM Application',
    objective: 'Connect the problem to a concrete real-world object or action first, then build and solve the math model step by step.',
    diagnosticFocus: 'Ask what real-world action, container size, or physical force is happening in the scenario before writing or solving the formula.',
    progressionRule: 'Connect each real-world observation to its matching number or part in the math model and solve step by step.'
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
    .replace(/<\/?diagram>/gi, ' ')
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

  return `You are a warm, knowledgeable Ontario STEM Teacher (Grades 6–12: Elementary/Middle School Math & Science Grades 6–8, and High School Grades 9–12 Math, Calculus & Vectors MCV4U, Functions MCR3U/MHF4U, Physics SPH3U/SPH4U, Chemistry SCH3U/SCH4U).
Tutor Voice Persona: ${profile.title} (${profile.subtitle}).
Active Mode: ${mode.code} - ${mode.name} (${mode.objective}).
Active Mode Diagnostic Focus: ${mode.diagnosticFocus}
Active Mode Progression Rule: ${mode.progressionRule}

# [SYSTEM SPECIFICATION: FLIGHT OPERATIONS MANUAL - CAN-ON-SVS-PROTOTYPE]

## 00. OPERATIONAL DIRECTIVES & MULTI-CHANNEL DECOUPLING
The system operates simultaneously across decoupled communication channels in a single response stream:

1. \`<hud> ... </hud>\` (EXPLICIT VISUAL QUESTION & STEP DISPLAY ON LEFT HUD CANVAS):
   - MANDATORY CLARITY RULE: Whenever you provide an example or ask a question, \`<hud>\` MUST ALWAYS clearly state what the example or equation is AND what question/goal is being asked so the student can see the question visually on the HUD!
   - NEVER emit a vague, isolated symbol or fragment (e.g., NEVER emit just \`<hud>t = 3\\text{s}</hud>\` or \`<hud>64</hud>\`).
   - Always include both the concrete equation/example and the clear target question inside \`<hud>\`, such as:
     * \`<hud>\\text{Example: } \\frac{32\\text{ blocks}}{64\\text{ per slot}} = ? \\quad (\\text{What fraction of 1 slot is filled?})</hud>\`
     * \`<hud>2x^2 - 8x = 0 \\quad (\\text{Goal: Find } x \\text{ where graph height } y = 0)</hud>\`
     * \`<hud>v_i = 0,\\; t = 3\\text{ s},\\; a = ? \\implies v_f = v_i + a \\cdot t</hud>\`
   - IMPORTANT LATEX RULE: Write pure LaTeX inside \`<hud> ... </hud>\` WITHOUT any \`$\` or \`$$\` dollar signs!
2. \`<diagram> ... </diagram>\` (VISUAL AID DIAGRAM FOR GRADE 6–8 & CONCEPTUAL UNDERSTANDING — ONLY WHEN NECESSARY):
   - Emit a single-line JSON \`<diagram>\` block ONLY when a visual aid diagram will genuinely improve the student's understanding (especially helpful for elementary/middle-school Grade 6–8 topics like fractions, ratios, number lines, balance-scale equations, and area/perimeter models).
   - Do NOT emit \`<diagram>\` when it is not needed.
   - Supported \`"type"\` formats when needed:
     * \`"fraction_bar"\`: \`<diagram>{"type":"fraction_bar","title":"Minecraft Slot Fraction (32 out of 64 blocks)","numerator":32,"denominator":64,"unitLabel":"1 Full Slot = 64 Blocks","caption":"32 blocks fill exactly half (1/2) of a 64-block slot."}</diagram>\`
     * \`"balance_scale"\`: \`<diagram>{"type":"balance_scale","title":"Equation Balance Scale","left":"2x + 4","right":"10","caption":"Both sides weigh the same—subtract 4 from both pans to keep it balanced."}</diagram>\`
     * \`"number_line"\`: \`<diagram>{"type":"number_line","title":"Number Line Jump","min":-5,"max":5,"start":-2,"end":3,"caption":"Starting at -2 and moving +5 steps right lands at +3."}</diagram>\`
     * \`"ratio_bars"\`: \`<diagram>{"type":"ratio_bars","title":"Ratio Comparison","labelA":"Part A","valueA":3,"labelB":"Part B","valueB":5,"caption":"Comparing 3 parts to 5 parts."}</diagram>\`
     * \`"area_model"\`: \`<diagram>{"type":"area_model","title":"Rectangle Area Model","widthLabel":"6 m","heightLabel":"4 m","insideLabel":"Area = 6 × 4 = 24 m²","caption":"Area counts the total squares inside the rectangle."}</diagram>\`
3. \`<graph> ... </graph>\` (DEMONSTRATION & FUNCTION GRAPH ON THE LEFT HUD CANVAS — SELECTIVE USE ONLY, PERSISTENT & LOCKED BY DEFAULT):
   - Do NOT emit a \`<graph>\` block on every turn or for arithmetic, elementary fractions, physics formulas, or algebra steps where a coordinate graph is not needed.
   - Emit a \`<graph>\` block ONLY when:
     (a) The student explicitly asks to plot or see a graph, OR
     (b) A coordinate graph is needed to demonstrate an idea or example (such as a tangent line touching a parabola curve).
   - GRAPH PERSISTENCE & STABILITY RULE: Once a graph is created to demonstrate an idea (e.g., \`f(x) = x^2\` and its tangent line \`y = 2x - 1\`), it stays pinned on the student's Left HUD Canvas across follow-up turns! Do NOT constantly change the functions on follow-up turns, and set \`"interactive": false\` by default so the graph stays locked and steady (set \`"interactive": true\` ONLY if the student must actively trace points or test how changing equation parameters changes the graph).
   - Format when needed: \`<graph>{"functions":["x^2","2*x - 1"],"title":"Tangent Line y = 2x - 1 to Parabola f(x) = x^2","xDomain":[-4,5],"yDomain":[-3,9],"interactive":false}</graph>\`
3b. \`<table_data> ... </table_data>\` (OPTIONAL STRUCTURED SUMMARY TABLE):
   - When comparing numbers, factor pairs, or step values helps clarity, you may emit a single-line JSON table:
     \`<table_data>{"headers":["Part","Value","Meaning"],"rows":[["Top (Numerator)","32","Blocks you have"],["Bottom (Denominator)","64","Blocks in 1 full slot"]]}</table_data>\`
4. \`<telemetry> ... </telemetry>\` (BACKEND DASHBOARD / METRIC ENGINE):
   - Emits a single-line minified JSON payload:
     \`<telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":85,"i_reg":90,"cli":80,"hint_level":0,"session_complete":false}</telemetry>\`
   - Set \`"session_complete": true\` ONLY when the student has reached the final answer or finished solving/understanding the problem!
5. [PLAIN SPOKEN TEXT] (AUDIO SYNTHESIZER — MATH-LITERACY-ACCESSIBLE PHRASING):
   - Everything outside \`<hud>\`, \`<diagram>\`, \`<graph>\`, \`<table_data>\`, and \`<telemetry>\` tags is routed to the voice emitter.
   - Strict 1–2 sentence limit (aim for 15 to 28 spoken words, strictly under ${maxWords} spoken words). Zero preamble.
   - NEVER use \`$\` signs or LaTeX commands in the spoken text.
   - PLAIN MATH-LITERACY-ACCESSIBLE PHRASING (CRITICAL):
     * Every question you ask—whether it is a diagnostic survey question to gauge understanding, a clue-gathering question, or a step-by-step guiding question—MUST be phrased in plain, concrete, everyday language so that a student **even with a weak math literacy background** can immediately understand what is being asked!
     * Avoid unexplained jargon like "graphical feature", "linear coefficient", "radicand", "secant slope", or "monomial factor".
     * Whenever you mention a math term, pair it right away with its plain everyday meaning (for example: instead of asking "What graphical feature are we looking for when the equation equals zero?", ask "When this equation equals zero, the height on the graph is zero—where does the curve touch the flat horizontal x-axis?"; instead of "What is the denominator?", ask "What number goes on the bottom of our fraction to show how many items fill one whole box?").
   - END-OF-SESSION SOLUTION VIDEO OFFER: When the student finishes solving the problem (\`"session_complete": true\`), congratulate them briefly and ask: "Would you like to watch a full step-by-step solution video with voice explanation for this question?" (Never mention the word "Manim" or internal engine names).

---

## 15. COLD-START BASELINE CALIBRATION (MICRO-DIAGNOSTIC PROBING)
Do not assume the student's foundation based solely on their immediate question. Before initiating the Hint Ladder or Socratic derivation for a new topic, you MUST perform a "Micro-Diagnostic" to map their current cognitive coordinates, adapted to the Active Mode (${mode.code} - ${mode.name}) and phrased in plain, everyday English that any student can understand.

### DIAGNOSTIC RULES OF ENGAGEMENT:
1. THE 2-SHOT LIMIT:
   - You are permitted a MAXIMUM of 2 clear, friendly diagnostic questions before proceeding to the actual problem.
   - Do not rapid-fire. One question per audio turn.
2. CONCEPT OVER COMPUTATION (IN PLAIN EVERYDAY WORDS):
   - Check the core idea in plain language before calculating.
   - Always make sure \`<hud>\` visually shows both the example/equation AND the question being asked.
3. LOW-STAKES FRAMING (NON-INTIMIDATING):
   - Soften the probe so it feels like friendly teamwork, not a test.
   - Acceptable openers: "Before we tackle the numbers, let's check our starting point...", "Just so we start at the best spot...", "Let's look at the big picture first..."
4. IMMEDIATE ABORT ON STALL (THE SAFETY NET):
   - If the student hesitates, expresses uncertainty, or misses the diagnostic probe, do NOT ask a second diagnostic question.
   - Immediately drop to foundational scaffolding: briefly supply the missing concept in one clear, everyday sentence and ask a simple Step 1 question (tagging \`"delib_state": "COGNITIVE_STALL"\` and \`"hint_level": 1\`).

---

### DIAGNOSTIC OPERATIONAL EXAMPLES:

#### CASE 1: VERIFYING BASE CONCEPT (PHYSICS - KINEMATICS)
Student: "How do I find the final velocity if it drops for 3 seconds?"
[BAD ACTION: Showing a vague <hud>t = 3s</hud> or jumping straight to v_f = v_i + at]
[CORRECT ACTION: Explicit <hud> showing given + goal, and a plain-English diagnostic question]
Transmission:
<hud>
\\text{Dropped Object: } t = 3\\text{ s},\\; v_i = 0 \\implies \\text{Find final speed } v_f \\text{ (What force pulls it down?)}
</hud>
<telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":80,"i_eff":80,"i_reg":90,"cli":83,"hint_level":0,"session_complete":false}</telemetry>
We can definitely find that final speed! First, when an object drops in free fall, what force pulls it downward and how much speed does it gain each second?

#### CASE 2: VERIFYING BASE CONCEPT (MATH - QUADRATICS)
Student: "I keep getting the wrong answer for 2x^2 - 8x = 0."
[BAD ACTION: Asking vaguely "What graphical feature are we looking for?"]
[CORRECT ACTION: Explicit <hud> + plain-English question anyone with weak math literacy can understand]
Transmission:
<hud>
2x^2 - 8x = 0 \\quad (\\text{Goal: Find } x \\text{ where graph height } y = 0)
</hud>
<telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":85,"i_reg":90,"cli":86,"hint_level":0,"session_complete":false}</telemetry>
Let's find where the mix-up happens! When this equation equals zero, the height y on the graph is zero—what do we call the points where the curve crosses the flat horizontal x-axis?

#### CASE 3: ABORTING DIAGNOSTIC ON STUDENT STALL (THE SAFETY NET)
Student (answering the Case 2 probe): "Uh... the y-axis?"
[BAD ACTION: Asking a second diagnostic question like "No, what about the x-axis?"]
[CORRECT ACTION: Abort diagnostic, provide immediate plain-English foundational bridge]
Transmission:
<hud>
2x^2 - 8x = 0 \\implies 2x(\\text{?}) = 0 \\quad (\\text{Factor out what divides both } 2x^2 \\text{ and } 8x)
</hud>
<telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":60,"i_eff":55,"i_reg":80,"cli":64,"hint_level":1,"session_complete":false}</telemetry>
Close! Height zero is actually the horizontal x-axis (the x-intercepts). Looking at 2x squared minus 8x, what biggest number and letter can divide evenly into both parts?

---

## 16. TOPIC ANCHOR, CLUE-GATHERING GAP DISCOVERY & GROUND-UP LOGICAL FLOW
Throughout elongated conversations, you MUST obey these four rules on every single turn:

1. UNBREAKABLE TOPIC ANCHOR (NEVER STRAY FROM THE MAIN QUESTION/TOPIC):
   - Lock onto the student's main question, topic, and scenario (for example, if the student asks about real-world applications of fractions in Minecraft using stash boxes/chests, stay 100% anchored to fractions in Minecraft stash boxes until that topic is completely understood).
   - NEVER lose track of the main stream of thought or drift into unrelated examples or topics (for instance, NEVER switch from fractions in Minecraft to solving a linear equation or unrelated algebra).

2. NEVER GUESS THE LEARNING GAP ON "I DON'T KNOW" OR "CAN I HAVE A HINT?":
   - When the student responds with "I don't know", "not sure", "I'm confused", or "Can I have a hint?", NEVER guess what their learning gap is and NEVER invent random new analogies or switch examples.
   - Instead, ASK BACK the student in plain, everyday words to pinpoint what part feels missing or unclear and encourage them to identify the specific point they are struggling to understand so you can gather a clue (e.g., "No worries! Staying with our Minecraft stash box fraction, which part feels tricky right now—what the bottom number of the fraction means, or how many blocks fill one slot?").

3. FILL THE EXACT FUNDAMENTAL GAP ONCE A CLUE IS GATHERED:
   - Once the student's reply gives you a clue about what they are struggling with, directly fill that exact fundamental gap from the ground up within the SAME topic/scenario using plain everyday language.
   - Do not skip foundational ground or jump to the next concept before checking that the student understands the current foundational piece.

4. ANALYZE EVERY RESPONSE FOR ENGAGEMENT & BUILD A STEP-BY-STEP FLOW OF LOGIC:
   - Carefully analyze every response from the student to gauge their engagement and comprehension level.
   - Use the conversation to help the student build a clear, connected flow of logic for the topic from the fundamental ground up, verifying their understanding at each step before moving forward.`;
}

/**
 * Analyzes every student response to gauge engagement, detect uncertainty / hint requests ("I don't know", "Can I have a hint?"),
 * detect diagnostic clues about learning gaps, and enforce Topic Anchor + Clue-Gathering pedagogy.
 */
export function analyzeStudentResponseAndEngagement(utterance = '', context = {}) {
  const raw = String(utterance || '').trim();
  const norm = raw.toLowerCase();
  const activeTopicAnchor = String(context.activeTopicAnchor || '').trim();
  const uncertaintyStreak = Number(context.uncertaintyStreak) || 0;
  const lastTurnAskedForClue = Boolean(context.lastTurnAskedForClue);

  const isUncertain =
    /^(i\s+don'?t\s+know|idk|no\s+idea|not\s+sure|i\s+am\s+not\s+sure|i'?m\s+not\s+sure|i'?m\s+lost|i\s+am\s+lost|i\s+have\s+no\s+clue|no\s+clue|stuck|i'?m\s+stuck|confused|i'?m\s+confused|i\s+don'?t\s+get\s+it|i\s+don'?t\s+understand|unsure|help|huh|\?+)[.!?\s]*$/i.test(
      norm
    ) ||
    /\b(i\s+don'?t\s+know|idk|have\s+no\s+idea|don'?t\s+understand\s+this|completely\s+lost)\b/i.test(
      norm
    );

  const isHintRequest =
    /\b(can\s+i\s+have\s+a\s+hint|give\s+me\s+a\s+hint|need\s+a\s+hint|hint\s+please|any\s+hint|what\s+is\s+the\s+hint)\b/i.test(
      norm
    ) || /^hint[.!?\s]*$/i.test(norm);

  const isUncertainOrHintRequest = isUncertain || isHintRequest;

  // Detect if the student is providing a specific clue about what confuses them
  const namesSpecificStrugglePoint =
    !isUncertainOrHintRequest &&
    (lastTurnAskedForClue ||
      /\b(confused\s+about|don'?t\s+get\s+the|don'?t\s+understand\s+why|don'?t\s+understand\s+how|what\s+does\s+the|what\s+is\s+a|why\s+do\s+we|how\s+do\s+we|the\s+first\s+part|the\s+second\s+part|the\s+bottom|the\s+top|denominator|numerator|fraction|box|stack|slot|factor|coefficient|slope|formula|step)\b/i.test(
        norm
      ));

  const topicLabel = activeTopicAnchor || 'the current problem';

  if (isUncertainOrHintRequest) {
    if (!lastTurnAskedForClue) {
      return {
        isUncertain,
        isHintRequest,
        isUncertainOrHintRequest: true,
        hasSpecificClue: false,
        nextUncertaintyStreak: uncertaintyStreak + 1,
        nextAskedForClue: true,
        engagementState: 'CLUE_GATHERING_PROBE',
        directive: `[SECTION 16 CLUE-GATHERING DIRECTIVE (Student said: "${raw}" | Active Topic Anchor: "${topicLabel}"): Do NOT guess the student's learning gap, do NOT try a random new analogy, and NEVER switch away from "${topicLabel}"! Instead, warmly ask the student back what specific point feels missing or confusing right now and encourage them to identify the part they are struggling with (offer 2 simple, concrete pieces of the current step in "${topicLabel}" so they can easily point out where they are stuck).]`
      };
    }

    // Student said "I don't know" even after we asked them to identify the missing point ->
    // Stay strictly on the same topic, drop to the most fundamental ground-level building block, explain that one piece simply, and ask a tiny check question.
    return {
      isUncertain,
      isHintRequest,
      isUncertainOrHintRequest: true,
      hasSpecificClue: false,
      nextUncertaintyStreak: uncertaintyStreak + 1,
      nextAskedForClue: false,
      engagementState: 'GROUND_UP_FOUNDATIONAL_BRIDGE',
      directive: `[SECTION 16 GROUND-UP FOUNDATION DIRECTIVE (Student still uncertain after clue probe | Streak=${uncertaintyStreak + 1} | Active Topic Anchor: "${topicLabel}"): NEVER switch topics or invent an unrelated example (such as linear equations)! Stay 100% inside "${topicLabel}". Explain the single most fundamental starting concept of "${topicLabel}" in 1 simple, concrete sentence, and ask a tiny, easy check question to verify their understanding of that foundation before moving forward.]`
    };
  }

  if (namesSpecificStrugglePoint) {
    return {
      isUncertain: false,
      isHintRequest: false,
      isUncertainOrHintRequest: false,
      hasSpecificClue: true,
      nextUncertaintyStreak: 0,
      nextAskedForClue: false,
      engagementState: 'CLUE_IDENTIFIED_FILL_GAP',
      directive: `[SECTION 16 FILL-THE-GAP DIRECTIVE (Clue gathered from student: "${raw}" | Active Topic Anchor: "${topicLabel}"): The student has identified the point they are struggling with! Directly fill this exact learning gap from the fundamental ground up in 1 clear sentence within "${topicLabel}", and ask a simple verification question to confirm they understand this point before advancing to the next concept.]`
    };
  }

  return {
    isUncertain: false,
    isHintRequest: false,
    isUncertainOrHintRequest: false,
    hasSpecificClue: false,
    nextUncertaintyStreak: 0,
    nextAskedForClue: false,
    engagementState: 'ENGAGED_LOGICAL_FLOW',
    directive: `[SECTION 16 LOGICAL FLOW & ENGAGEMENT DIRECTIVE (Active Topic Anchor: "${topicLabel}"): Carefully analyze the student's response ("${raw}") to gauge their understanding and engagement. Stay 100% anchored to "${topicLabel}". Confirm whether they truly grasp the current foundational concept before guiding them to the next logical step in the chain of thought.]`
  };
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
 * Generates an instant fallback Learning-Gap Analysis behind the scenes
 * (diagnosing the hidden prerequisite concept that may cause a student to stall at this step)
 */
export function generateFallbackLearningGapAnalysis({
  lastHudLatex = '',
  lastTutorQuestion = '',
  lastStudentMessage = ''
} = {}) {
  const qNorm = `${lastTutorQuestion} ${lastHudLatex} ${lastStudentMessage}`.toLowerCase();

  if (/multiply|add\s+up|factor|decomposition|2x\^2/i.test(qNorm)) {
    return {
      missingConcept: 'Product-Sum Decomposition & Zero-Product Property',
      whyStuck: 'Difficulty seeing why we multiply the leading coefficient a by c before splitting the middle term b.',
      bridgingStrategy: 'Connect the student’s response to reverse-FOIL (expanding two binomials) so the product a·c and sum b feel intuitive.',
      stage2OfferSpoken: 'It looks like this factoring step might feel tricky right now. Would you like me to explain the underlying concept behind product-sum decomposition?',
      conceptExplanationHud: 'ax^2 + bx + c = ax^2 + px + qx + c \\quad (p \\cdot q = a \\cdot c,\\; p + q = b)',
      conceptExplanationSpoken: 'When we expand two brackets, the outer and inner products multiply to a times c and add up to the middle number b. Looking at a equals two and c equals two, what is two times two?'
    };
  }

  if (/graphical\s+feature|equals\s+zero|intercept|2x\^2\s*-\s*8x/i.test(qNorm)) {
    return {
      missingConcept: 'Root-Intercept Equivalence (Setting y = 0 on a Coordinate Graph)',
      whyStuck: 'Not connecting the algebraic condition f(x) = 0 with the geometric height y = 0 along the horizontal x-axis.',
      bridgingStrategy: 'Relate the student’s idea to height above the ground: when y is zero, the curve touches the horizontal x-axis.',
      stage2OfferSpoken: 'Take your time! Would you like me to explain the concept connecting an equation equaling zero to its graph?',
      conceptExplanationHud: 'f(x) = 0 \\iff y = 0 \\text{ (Points on the horizontal } x\\text{-axis)}',
      conceptExplanationSpoken: 'Think of y as the vertical height of the curve. Whenever an equation equals zero, its height is zero, which happens right where the curve crosses the horizontal x-axis!'
    };
  }

  if (/secant|derivative|instantaneous|h\)\^2|cancel/i.test(qNorm)) {
    return {
      missingConcept: 'Difference Quotient & Secant-to-Tangent Limit Intuition',
      whyStuck: 'Uncertain how the average slope between (x, f(x)) and (x+h, f(x+h)) simplifies algebraically before h approaches zero.',
      bridgingStrategy: 'Relate their response to ordinary rise-over-run slope, then show how expanding (x+h)² cancels the original x² term.',
      stage2OfferSpoken: 'This first-principles step has a few pieces. Would you like me to explain the concept behind the secant slope formula?',
      conceptExplanationHud: 'm_{\\text{sec}} = \\frac{\\text{Rise}}{\\text{Run}} = \\frac{(x+h)^2 - x^2}{h} = \\frac{2xh + h^2}{h}',
      conceptExplanationSpoken: 'The formula is just rise over run between two nearby points on the curve. When we expand x plus h squared into x squared plus two x h plus h squared, notice how the x squared terms cancel right out!'
    };
  }

  if (/domain|radical|sqrt|denominator/i.test(qNorm)) {
    return {
      missingConcept: 'Real-Number Domain Restrictions (Even Radicals & Zero Denominators)',
      whyStuck: 'Overlooking that square roots require non-negative inputs (radicand ≥ 0) even after solving the denominator.',
      bridgingStrategy: 'Relate their candidate solution directly to testing whether the inside of the square root stays non-negative.',
      stage2OfferSpoken: 'Would you like me to explain the concept behind domain restrictions for radicals and fractions?',
      conceptExplanationHud: '\\sqrt{u} \\implies u \\ge 0, \\quad \\frac{1}{v} \\implies v \\ne 0',
      conceptExplanationSpoken: 'In real numbers, two rules protect our domain: we can never divide by zero, and the number inside a square root must be zero or positive. What happens inside the square root if x is negative three?'
    };
  }

  return {
    missingConcept: 'Core Algebraic & Conceptual Mapping of the Step',
    whyStuck: 'Translating the verbal or physical relationship into the next isolated algebraic operation.',
    bridgingStrategy: 'Acknowledge the student’s perspective and break the governing relationship into a concrete numerical example first.',
    stage2OfferSpoken: 'It looks like this step might be a bit tricky. Would you like me to explain the underlying concept behind this question?',
    conceptExplanationHud: sanitizeLatexForHud(lastHudLatex || 'y = f(x)'),
    conceptExplanationSpoken: 'Let us look at the core idea behind this step: we want to isolate how one quantity changes when we adjust the other. Which number or variable in the equation do we already know?'
  };
}

/**
 * Generates the Stage 2 (second 15-second timeout) message offering to explain the concept
 */
export function generateStage2ConceptOffer({
  gapAnalysis = null,
  activeTier = 2,
  lastHudLatex = '',
  lastTutorQuestion = ''
} = {}) {
  const fallback = generateFallbackLearningGapAnalysis({ lastHudLatex, lastTutorQuestion });
  const activeGap = gapAnalysis && gapAnalysis.stage2OfferSpoken ? gapAnalysis : fallback;

  const telemetry = normalizeTelemetryPayload({
    step_tier: activeTier,
    delib_state: 'COGNITIVE_STALL',
    i_flow: 64,
    i_eff: 62,
    i_reg: 82,
    cli: 68,
    hint_level: 1,
    session_complete: false
  });

  return {
    hudLatex: sanitizeLatexForHud(lastHudLatex || ''),
    telemetry,
    spokenText: activeGap.stage2OfferSpoken,
    missingConcept: activeGap.missingConcept,
    gapAnalysis: activeGap
  };
}

let lastNextQuestionPromptIndex = -1;

/**
 * Generates a varied, natural follow-up prompt after a question session or solution video finishes playing
 * so the chatbot recognizes the question is complete and asks what other questions the student has without repeating itself.
 */
export function generateNextQuestionPrompt(topicTitle = '') {
  const cleanTitle = String(topicTitle || '')
    .replace(/^Step-by-Step\s+Solution\s*:\s*/i, '')
    .replace(/\$/g, '')
    .trim();

  const prompts = [
    cleanTitle
      ? `That wraps up our complete solution for ${cleanTitle}! What other questions do you have, or what problem would you like to try next?`
      : 'That wraps up our complete step-by-step solution! What other questions do you have, or what problem would you like to try next?',
    'We have finished working through this question from start to finish. What other STEM question or topic can we explore together next?',
    'I hope that step-by-step breakdown made everything crystal clear! Do you have any follow-up questions on this, or what new problem should we tackle?',
    'Nice work seeing that problem all the way through! What other questions are on your mind today?',
    'That completes our walkthrough for this question. Whenever you are ready, what next question or concept would you like to work on?',
    'Everything for this problem is complete! What other math or science question would you like to solve next?'
  ];

  const idx = (lastNextQuestionPromptIndex + 1) % prompts.length;
  lastNextQuestionPromptIndex = idx;
  return prompts[idx];
}

/**
 * Checks if the user's message is explicitly asking to plot, draw, or show a graph
 * (Does NOT trigger merely because a follow-up question mentions the word "curve" or "parabola").
 */
export function isGraphRequestedByUser(utterance = '') {
  const norm = String(utterance || '').toLowerCase().trim();
  return (
    /\b(graph|plot|sketch|visuali[sz]e)\b/i.test(norm) ||
    /\b(draw|show)\s+(me\s+)?(the\s+|a\s+)?(graph|plot|curve|parabola|tangent)\b/i.test(norm) ||
    /\bwhat\s+does\s+(the\s+)?(graph|curve|parabola)\s+look\s+like\b/i.test(norm)
  );
}

/**
 * Determines whether a graph should be unlocked/interactive (movable/traceable/parameter-testing)
 * vs. locked/static (default for demonstrating an idea or example).
 */
export function isInteractiveGraphNeeded(utterance = '', graphSpec = null) {
  if (graphSpec && typeof graphSpec.interactive === 'boolean') {
    return graphSpec.interactive;
  }
  const norm = String(utterance || '').toLowerCase();
  return /\b(trace|tracing|test\s+out|test\s+different|change\s+the\s+parameter|change\s+parameters|adjust\s+the|move\s+the\s+graph|zoom|pan|interactive|what\s+difference\s+.*parameter)\b/i.test(
    norm
  );
}

/**
 * Extracts a plottable function expression from a LaTeX HUD string or user utterance
 * when the user asks for a graph.
 */
export function buildFallbackGraphSpec(hudLatex = '', utterance = '', existingGraphSpec = null) {
  const combined = `${utterance} ${hudLatex}`.toLowerCase();

  // Special case: Tangent line to a parabola demonstration
  if (/\btangent\b/i.test(combined) && /\b(parabola|curve|x\^2)\b/i.test(combined)) {
    return {
      functions: [
        { expr: 'x^2', label: 'Parabola: f(x) = x^2', color: '#38bdf8' },
        { expr: '2*x - 1', label: 'Tangent at x = 1: y = 2x - 1', color: '#facc15' }
      ],
      points: [{ x: 1, y: 1, label: 'Point of Tangency (1, 1)', color: '#4ade80' }],
      title: 'Tangent Line to Parabola f(x) = x² at (1, 1)',
      xDomain: [-3, 4],
      yDomain: [-2, 8],
      interactive: isInteractiveGraphNeeded(utterance)
    };
  }

  // If an existing graph was already created in this session and no new explicit equation is in `utterance`, keep it steady!
  const userExprMatch = utterance.match(/(?:y\s*=\s*|f\(x\)\s*=\s*|graph\s+of\s+|graph\s+|plot\s+)([0-9a-zA-Z^+\-*/().\s\\]+)/i);
  const candidates = [];

  if (userExprMatch && userExprMatch[1]) {
    const cleaned = userExprMatch[1]
      .replace(/\b(please|for\s+me|now|in\s+the\s+chat|and\s+help\s+me.*)\b/gi, '')
      .trim();
    if (cleaned && /[x\d]/i.test(cleaned)) {
      candidates.push(cleaned);
    }
  }

  if (candidates.length === 0 && existingGraphSpec && Array.isArray(existingGraphSpec.functions) && existingGraphSpec.functions.length > 0) {
    return {
      ...existingGraphSpec,
      interactive: isInteractiveGraphNeeded(utterance, existingGraphSpec)
    };
  }

  if (candidates.length === 0 && hudLatex) {
    // Strip parenthetical goals before extracting expression
    const strippedHud = hudLatex.replace(/\\quad\s*\([\s\S]*?\)/g, '');
    const parts = strippedHud.split(/\\implies|\\quad|;/);
    for (const part of parts) {
      if (/x/i.test(part) && !/\\Delta\s*y|\\text/i.test(part)) {
        candidates.push(part.trim());
        break;
      }
    }
  }

  const expr = candidates[0] || '2*x^2 + 5*x + 2';
  return {
    functions: [expr],
    title: `Graph: ${expr}`,
    xDomain: [-8, 8],
    yDomain: [-6, 10],
    interactive: isInteractiveGraphNeeded(utterance)
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
 * Extracts the clearest question sentence being asked in `spokenText` so the Left HUD Canvas
 * can always display what question is currently being asked visually.
 */
export function extractVisualQuestionFromSpoken(spokenText = '') {
  const clean = String(spokenText || '').replace(/\$/g, '').trim();
  if (!clean) return '';

  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  const questionSentences = sentences
    .map(s => s.trim())
    .filter(s => s.endsWith('?'));

  if (questionSentences.length > 0) {
    return questionSentences[questionSentences.length - 1];
  }
  return sentences[sentences.length - 1].trim();
}

/**
 * Summarizes a conversation turn into a concise, scannable Key Point (`keyMathLatex` + short `keyPointText`)
 * for the Left HUD Canvas Step Progression list so the user can read through what was discussed quickly
 * without verbose question sentences or duplicate text.
 */
export function summarizeStepKeyPoint(hudLatex = '', spokenText = '') {
  const rawHud = sanitizeLatexForHud(hudLatex);

  // Strip parenthetical prompts like `\quad (\text{Goal: ...})` or `\text{Example: }` so only the core formula remains
  let keyMathLatex = rawHud
    .replace(/\\quad\s*\([^)]*\\text\{[\s\S]*?\)/gi, '')
    .replace(/\([^)]*\\text\{[\s\S]*?\)/gi, '')
    .replace(/^\\text\{\s*(?:Example|Question|Problem\s+Goal)\s*:\s*\}\s*/i, '')
    .replace(/\\implies\s*\\text\{Find[\s\S]*$/i, '')
    .trim();

  if (!keyMathLatex) {
    keyMathLatex = rawHud;
  }

  // Build a short 4–9 word key-point bullet summarizing what was discussed/established
  const cleanSpoken = String(spokenText || '').replace(/\$/g, '').trim();
  const sentences = (cleanSpoken.match(/[^.!?]+[.!?]+/g) || [cleanSpoken]).map(s => s.trim()).filter(Boolean);

  // Prefer a declarative concept/fact sentence if present; otherwise condense the question into a short topic phrase
  const declarative = sentences.find(
    s =>
      !s.endsWith('?') &&
      !/^(great|close|nice|no\s+worries|we\s+can|let'?s\s+find|minecraft\s+stash\s+boxes\s+are)/i.test(s)
  );

  let sourceText = declarative || sentences[sentences.length - 1] || '';
  sourceText = sourceText
    .replace(/^(close!|great!|exactly!|nice\s+work!|no\s+worries\s+at\s+all!|before\s+we\s+[^,]+,|just\s+so\s+we\s+[^:]+:|let'?s\s+[^:]+:)\s*/i, '')
    .replace(/\?+$/, '')
    .trim();

  const words = sourceText.split(/\s+/).filter(Boolean);
  const keyPointText =
    words.length > 10 ? `${words.slice(0, 10).join(' ')}…` : words.join(' ');

  return {
    keyMathLatex,
    keyPointText: keyPointText || 'Key concept step'
  };
}

/**
 * Guarantees that `hudLatex` is never empty or vague when the tutor gives an example or asks a question.
 * If the raw `<hud>` is missing or is just a tiny isolated fragment without context, enriches it with the
 * active example/question context so the student can see what the question is talking about on the HUD.
 */
export function ensureExplicitHudLatex(rawHudLatex = '', spokenText = '', activeTopicAnchor = '') {
  let hud = sanitizeLatexForHud(rawHudLatex);
  const spoken = String(spokenText || '').trim();
  const combined = `${activeTopicAnchor} ${spoken}`.toLowerCase();

  if (!hud) {
    if (/minecraft|stash|slot|stack|64/i.test(combined)) {
      return '\\text{Example: } \\frac{\\text{Blocks Have}}{64\\text{ per Slot}} = ?';
    }
    if (/fraction|numerator|denominator/i.test(combined)) {
      return '\\text{Fraction} = \\frac{\\text{Part (Top)}}{\\text{Whole (Bottom)}}';
    }
    const qText = extractVisualQuestionFromSpoken(spoken);
    if (qText) {
      const shortQ = qText.replace(/[\\{}]/g, '').slice(0, 62);
      return `\\text{Question: ${shortQ}}`;
    }
    return '';
  }

  // If the HUD is overly brief/vague (e.g. just "t = 3s" or "64") and doesn't show what we're finding, append the goal
  const plainLength = hud.replace(/\\text|[{}^_\\]/g, '').trim().length;
  const hasGoalOrImplies = /\\implies|\\quad|=.*\?|\bFind\b|\bGoal\b|\bExample\b/i.test(hud);
  if (plainLength > 0 && plainLength <= 14 && !hasGoalOrImplies && spoken.includes('?')) {
    if (/velocity|speed|drop|fall/i.test(combined) && /t\s*=\s*3/i.test(hud)) {
      return `${hud},\\; v_i = 0 \\implies \\text{Find final speed } v_f`;
    }
    if (/2x\^2\s*-\s*8x\s*=\s*0/i.test(hud)) {
      return `${hud} \\quad (\\text{Goal: Find } x \\text{ where height } y = 0)`;
    }
  }

  return hud;
}

/**
 * Infers an Elementary (Grade 6–8) / Visual Concept Aid Diagram ONLY when necessary and deemed
 * to improve the student's understanding (e.g. fractions, Minecraft stash slots, ratios, number lines,
 * balance-scale equations, area/perimeter models). Returns `null` when a diagram is not needed.
 */
export function inferElementaryDiagramIfHelpful(
  utterance = '',
  hudLatex = '',
  spokenText = '',
  activeTopicAnchor = ''
) {
  const combined = `${activeTopicAnchor} ${utterance} ${hudLatex} ${spokenText}`.toLowerCase();

  // Do not show a diagram on session-complete video offer turns
  if (/\b(solution\s+video|step-by-step\s+video|watch\s+a\s+full)\b/i.test(spokenText)) {
    return null;
  }

  // 1. Fractions / Minecraft Stash Boxes / Part-of-Whole (Grade 6–8)
  if (/\b(fraction|fractions|minecraft|stash|chest|slot|stack|numerator|denominator|half|quarter|third|eighths)\b/i.test(combined)) {
    let num = 32;
    let den = 64;
    let unitLabel = '1 Full Slot = 64 Blocks';
    let title = 'Visual Fraction Model: Minecraft Stash Slot';

    const fracMatch =
      hudLatex.match(/\\frac\{\s*(\d+)[^}]*\}\{\s*(\d+)[^}]*\}/) ||
      combined.match(/\b(\d+)\s*(?:out\s+of|over|\/)\s*(\d+)\b/);

    if (fracMatch) {
      const n = Number(fracMatch[1]);
      const d = Number(fracMatch[2]);
      if (Number.isFinite(n) && Number.isFinite(d) && d > 0 && n <= d * 2) {
        num = n;
        den = d;
      }
    } else if (/16\s+blocks/i.test(combined)) {
      num = 16;
      den = 64;
    } else if (/48\s+blocks/i.test(combined)) {
      num = 48;
      den = 64;
    } else if (!/minecraft|stash|slot|stack|64/i.test(combined)) {
      num = 3;
      den = 4;
      unitLabel = `1 Whole Divided into ${den} Equal Parts`;
      title = `Visual Fraction Bar (${num}/${den})`;
    }

    if (!/minecraft|stash|slot|stack|64/i.test(combined) && den !== 64) {
      unitLabel = `1 Whole = ${den} Equal Parts`;
      title = `Visual Fraction Bar (${num}/${den})`;
    }

    return {
      type: 'fraction_bar',
      title,
      numerator: num,
      denominator: den,
      unitLabel,
      caption: `${num} out of ${den} equal parts (${
        den === 64 && num === 32 ? '32/64 = 1/2 of a full slot' : `${num}/${den}`
      })`
    };
  }

  // 2. Ratios & Rates (Grade 6–8)
  if (/\b(ratio|ratios|proportion|tape\s+diagram|for\s+every)\b/i.test(combined)) {
    const ratioMatch = combined.match(/\b(\d+)\s*(?:to|:)\s*(\d+)\b/);
    const valA = ratioMatch ? Math.min(12, Math.max(1, Number(ratioMatch[1]))) : 3;
    const valB = ratioMatch ? Math.min(12, Math.max(1, Number(ratioMatch[2]))) : 5;
    return {
      type: 'ratio_bars',
      title: `Visual Ratio Tape Diagram (${valA} : ${valB})`,
      labelA: 'Group A',
      valueA: valA,
      labelB: 'Group B',
      valueB: valB,
      caption: `For every ${valA} parts in Group A, there are ${valB} parts in Group B.`
    };
  }

  // 3. Number Line / Integers / Adding & Subtracting Negatives (Grade 6–8)
  if (/\b(number\s+line|negative\s+number|integers|adding\s+negatives|subtracting\s+negatives|below\s+zero)\b/i.test(combined)) {
    return {
      type: 'number_line',
      title: 'Visual Number Line',
      min: -6,
      max: 6,
      start: -2,
      end: 3,
      caption: 'Moving right adds (+), and moving left subtracts (−) along the number line.'
    };
  }

  // 4. Elementary / Middle School 1-Variable Linear Balance Scale (e.g. 2x + 4 = 10, without x^2)
  if (
    !/x\^2|x\^3|quadratic|parabola|derivative|sin|cos/i.test(combined) &&
    (/\bbalance\s+scale\b/i.test(combined) ||
      /\b\d*x\s*[+-]\s*\d+\s*=\s*\d+\b/i.test(combined))
  ) {
    const eqMatch = combined.match(/(\d*x\s*[+-]\s*\d+)\s*=\s*(\d+)/i);
    const leftExpr = eqMatch ? eqMatch[1].replace(/\s+/g, ' ') : '2x + 4';
    const rightExpr = eqMatch ? eqMatch[2].trim() : '10';
    return {
      type: 'balance_scale',
      title: `Equation Balance Scale: ${leftExpr} = ${rightExpr}`,
      left: leftExpr,
      right: rightExpr,
      caption: 'An equation is like a balanced scale: do the same operation to both sides to keep it level.'
    };
  }

  // 5. Area & Perimeter Rectangle Model (Grade 6–8)
  if (/\b(area\s+of\s+a\s+rectangle|perimeter|length\s+and\s+width|square\s+meters|grid\s+model)\b/i.test(combined)) {
    return {
      type: 'area_model',
      title: 'Rectangle Area & Perimeter Visual Model',
      widthLabel: 'Length = 6 units',
      heightLabel: 'Width = 4 units',
      insideLabel: 'Area = 6 × 4 = 24 sq units',
      caption: 'Area measures the flat space inside (Length × Width); Perimeter measures the distance around the outside.'
    };
  }

  return null;
}

/**
 * MULTI-CHANNEL PARSER (`<hud>`, `<diagram>`, `<graph>`, `<telemetry>`, and Plain Spoken Audio)
 */
export function parseTriChannelPacket(rawText, maxWords = 30, fallbackTelemetry = null, activeTopicAnchor = '') {
  if (!rawText || typeof rawText !== 'string') {
    return {
      hudLatex: '',
      hudQuestionText: '',
      diagramSpec: null,
      graphSpec: null,
      tableSpec: null,
      telemetry: normalizeTelemetryPayload(fallbackTelemetry || DEFAULT_TELEMETRY),
      spokenText: '',
      audit: sanitizeForSpeech('', maxWords)
    };
  }

  const hudBlocks = [];
  let parsedTelemetry = null;
  let parsedGraph = null;
  let parsedTable = null;
  let parsedDiagram = null;

  // 1. Extract <hud>...</hud>
  let workingText = rawText.replace(/<hud>([\s\S]*?)<\/hud>/gi, (_match, inner) => {
    const cleanedInner = sanitizeLatexForHud(inner);
    if (cleanedInner) {
      hudBlocks.push(cleanedInner);
    }
    return ' ';
  });

  // 1b. Extract <diagram>...</diagram>
  workingText = workingText.replace(/<diagram>([\s\S]*?)<\/diagram>/gi, (_match, inner) => {
    try {
      const parsed = JSON.parse(inner.trim());
      if (parsed && typeof parsed === 'object' && parsed.type) {
        parsedDiagram = parsed;
      }
    } catch (_) {}
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

  const telemetry = normalizeTelemetryPayload(parsedTelemetry, fallbackTelemetry || DEFAULT_TELEMETRY);
  const audit = sanitizeForSpeech(workingText, maxWords);

  // Ensure `<hud>` clearly states what the example/question is about
  const rawJoinedHud = sanitizeLatexForHud(hudBlocks.join(' \\quad '));
  const hudLatex = ensureExplicitHudLatex(rawJoinedHud, audit.cleanText, activeTopicAnchor);
  const hudQuestionText = extractVisualQuestionFromSpoken(audit.cleanText);

  // Also detect if spoken text explicitly offers the step-by-step solution video
  if (/\b(solution\s+video|instructional\s+video|step-by-step\s+video|watch\s+a\s+full)\b/i.test(audit.cleanText)) {
    telemetry.session_complete = true;
  }

  return {
    hudLatex,
    hudQuestionText,
    diagramSpec: parsedDiagram,
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
    diagramStripped: false,
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

  if (/<diagram>[\s\S]*?<\/diagram>/i.test(text)) {
    text = text.replace(/<diagram>[\s\S]*?<\/diagram>/gi, ' ').trim();
    audit.diagramStripped = true;
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
    [/(\b\d+|\b[a-zA-Z]\b)\s+-\s+(\d+|\b[a-zA-Z]\b)/g, '$1 minus $2'],
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

/**
 * Splits spoken text into [shortFirstClause, remainder] after running `sanitizeForSpeech`.
 * Keeping the first clause short (3–9 words) allows Gemini Neural TTS to synthesize it in ~0.8s
 * inside `/api/chat` while the remainder synthesizes in the background—resulting in 0.0s delay
 * when the transcript appears on screen!
 */
export function splitSpokenTextIntoClauses(rawOrCleanText = '', maxWords = 30) {
  const clean = sanitizeForSpeech(rawOrCleanText, maxWords).cleanText;
  if (!clean) return [];

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 8) {
    return [clean];
  }

  // 1. Try splitting at a natural punctuation boundary (., !, ?, :, ;, ,) within the first 3 to 10 words
  let accWords = [];
  for (let i = 0; i < Math.min(words.length - 3, 10); i++) {
    accWords.push(words[i]);
    if (i >= 2 && /[.!?:;,—]$/.test(words[i])) {
      const firstClause = accWords.join(' ').trim();
      const remainder = words.slice(i + 1).join(' ').trim();
      if (firstClause.length >= 8 && remainder.length >= 4) {
        return [firstClause, remainder];
      }
    }
  }

  // 2. Otherwise split at the first sentence boundary
  const sentenceMatch = clean.match(/^([^.!?]+[.!?]+)\s+([\s\S]+)$/);
  if (sentenceMatch && sentenceMatch[1].trim().length >= 6 && sentenceMatch[2].trim().length >= 4) {
    return [sentenceMatch[1].trim(), sentenceMatch[2].trim()];
  }

  return [clean];
}

/**
 * Talking-Point & Script Continuity Verification Layer:
 *  1. Verifies whether an incoming voice transcript is actually a late-phrase speaker echo of the tutor's own script
 *     (so a voice glitch never interrupts the tutor or causes it to skip/lose its place).
 *  2. Verifies the exact talking point (`stepNumber`, `currentPointSummary`, `currentQuestionAsked`) and whether
 *     any clause of the tutor's script was left unread (`unspokenRemainderText`), generating an explicit
 *     `verificationDirective` so the chatbot never skips steps or loses where it was reading.
 */
export function verifyTalkingPointContinuity({
  utterance = '',
  isFromVoice = false,
  talkingPointState = {},
  activeTopicAnchor = ''
} = {}) {
  const raw = String(utterance || '').trim();
  const fullScript = String(talkingPointState?.fullScriptText || '').trim();
  const currentQuestion = String(talkingPointState?.currentQuestionAsked || '').trim();
  const currentPointSummary = String(talkingPointState?.currentPointSummary || '').trim();
  const unspokenRemainder = String(talkingPointState?.unspokenRemainderText || '').trim();
  const stepNumber = Number(talkingPointState?.stepNumber) || 1;

  const normCandidate = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidateWords = normCandidate.split(' ').filter(Boolean);

  // 1. Check if a voice transmission is a late-phrase echo of the tutor's current script
  if (isFromVoice && fullScript && candidateWords.length > 0) {
    const isGenuineIntent =
      /^(yes|yeah|yep|no|nope|nah|hint|help|wait|stop|i\s+dont\s+know|i\s+do\s+not\s+know|not\s+sure)$/i.test(
        normCandidate
      );

    if (!isGenuineIntent) {
      const normScript = fullScript
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const scriptWords = normScript.split(' ').filter(Boolean);
      const tailWords = scriptWords.slice(-10);
      const tailNorm = tailWords.join(' ');
      const tailSet = new Set(tailWords.filter(w => w.length >= 2));
      const tailStems = new Set(tailWords.filter(w => w.length >= 4).map(w => w.slice(0, 4)));

      if (normScript.endsWith(normCandidate) || (tailNorm && tailNorm.includes(normCandidate))) {
        return {
          shouldIgnoreAsEcho: true,
          reason: 'EXACT_TAIL_SCRIPT_ECHO',
          verificationDirective: ''
        };
      }

      if (candidateWords.length <= 5) {
        let matches = 0;
        let stemMatches = 0;
        for (const w of candidateWords) {
          if (tailSet.has(w)) matches++;
          else if (w.length >= 4 && tailStems.has(w.slice(0, 4))) {
            matches++;
            stemMatches++;
          }
          if (w.length >= 4 && tailStems.has(w.slice(0, 4))) {
            stemMatches++;
          }
        }
        if (
          (candidateWords.length === 1 && candidateWords[0].length >= 4 && stemMatches === 1) ||
          (candidateWords.length >= 2 &&
            matches / candidateWords.length >= 0.6 &&
            (matches >= 2 || stemMatches >= 1))
        ) {
          return {
            shouldIgnoreAsEcho: true,
            reason: 'FUZZY_TAIL_SCRIPT_ECHO',
            verificationDirective: ''
          };
        }
      }
    }
  }

  // 2. Build the Talking-Point Verification Directive so the chatbot always verifies what point it is talking about
  const topicLabel = activeTopicAnchor || 'Current STEM Problem';
  const pointLabel = currentPointSummary || 'Foundational Concept Check';
  const questionLabel = currentQuestion || fullScript || 'Initial problem setup';

  const recoveryNote = unspokenRemainder
    ? `\n3. UNREAD SCRIPT RECOVERY: Your previous spoken explanation had an unread remainder ("${unspokenRemainder}"). Smoothly incorporate that point so zero part of the script is skipped.`
    : '';

  const verificationDirective = fullScript
    ? `[TALKING-POINT VERIFICATION LAYER — Active Problem: "${topicLabel}" | Current Talking Point (Step ${stepNumber}): "${pointLabel}" | Exact Question Just Asked: "${questionLabel}"]:\n1. VERIFY CURRENT POINT: Confirm how the student's reply ("${raw}") addresses Step ${stepNumber} ("${pointLabel}") and the exact question "${questionLabel}".\n2. DO NOT SKIP STEPS OR LOSE PLACE: Stay anchored on Step ${stepNumber} until it is resolved; never skip ahead in the script or jump to an unrelated step.${recoveryNote}\n`
    : `[TALKING-POINT VERIFICATION LAYER — Active Problem: "${topicLabel}" | Step 1 Initialization]: Verify the core concept and start at Step 1 without skipping foundational ground.\n`;

  return {
    shouldIgnoreAsEcho: false,
    reason: 'VALID_STUDENT_TURN',
    stepNumber,
    currentPointSummary: pointLabel,
    currentQuestionAsked: questionLabel,
    needsScriptCompletion: Boolean(unspokenRemainder),
    verificationDirective
  };
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

export function detectFaultCondition(utterance, context = {}) {
  const norm = utterance.toLowerCase().trim();
  const activeTopic = String(context.activeTopicAnchor || '').toLowerCase();
  const hud = sanitizeLatexForHud(context.lastHudLatex || '') || '\\text{Part} / \\text{Whole}';

  const extortionPatterns = [
    /\bstop\s+asking\s+questions\s+and\s+just\s+do\s+my\s+homework\b/i,
    /\bdo\s+my\s+homework\s+for\s+me\b/i
  ];
  for (const pat of extortionPatterns) {
    if (pat.test(norm)) {
      return {
        code: 402,
        ...FAULT_CODES[402],
        interceptResponse: `<hud>${hud}</hud><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":55,"i_eff":50,"i_reg":60,"cli":75,"hint_level":1,"session_complete":false}</telemetry>I cannot hand over a finished assignment, but we can solve it together step by step. Which part of this problem should we look at first?`
      };
    }
  }

  const stallPatterns = [
    /^(i\s+don'?t\s+know|idk|no\s+idea|not\s+sure|i'?m\s+lost|i\s+have\s+no\s+clue|can\s+i\s+have\s+a\s+hint|give\s+me\s+a\s+hint|hint)[.!?\s]*$/i
  ];
  for (const pat of stallPatterns) {
    if (pat.test(norm)) {
      if (/minecraft|fraction|stash|chest|box/i.test(activeTopic)) {
        return {
          code: 401,
          ...FAULT_CODES[401],
          interceptResponse: `<hud>\\text{Example: } \\frac{\\text{Blocks Have (32)}}{\\text{Full Slot (64)}} = ? \\quad (\\text{What part feels confusing?})</hud><diagram>{"type":"fraction_bar","title":"Minecraft Stash Slot (32 out of 64 Blocks)","numerator":32,"denominator":64,"unitLabel":"1 Full Slot = 64 Blocks","caption":"Top number = blocks we have (32). Bottom number = blocks in 1 full slot (64)."}</diagram><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":55,"i_eff":55,"i_reg":70,"cli":72,"hint_level":1,"session_complete":false}</telemetry>No worries at all! Staying with our Minecraft stash boxes, which part feels confusing right now: what the bottom number of the fraction means, or how many blocks make one full stack?`
        };
      }
      return {
        code: 401,
        ...FAULT_CODES[401],
        interceptResponse: `<hud>${hud} \\quad (\\text{Which part feels unclear?})</hud><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":52,"i_eff":55,"i_reg":68,"cli":75,"hint_level":1,"session_complete":false}</telemetry>No worries at all! So we stay right on track, which part of this step feels unclear to you right now—what the numbers represent, or which step comes first?`
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

export function generateOfflineSocraticResponse(utterance, modeId = 1, _profileKey = 'CHARLIE', context = {}) {
  const cmd = detectSystemCommand(utterance);
  if (cmd) {
    return { text: cmd.response, command: cmd, fault: null };
  }

  const fault = detectFaultCondition(utterance, context);
  if (fault) {
    return { text: fault.interceptResponse, command: null, fault };
  }

  const norm = utterance.toLowerCase();

  if (/minecraft/i.test(norm) && /fraction/i.test(norm)) {
    return {
      text: `<hud>\\text{Example: } \\frac{32\\text{ blocks}}{64\\text{ per slot}} = ? \\quad (\\text{What fraction of 1 slot is filled?})</hud><diagram>{"type":"fraction_bar","title":"Minecraft Stash Slot (32 out of 64 Blocks)","numerator":32,"denominator":64,"unitLabel":"1 Full Slot = 64 Blocks","caption":"32 blocks out of 64 blocks fills half (1/2) of one stash slot."}</diagram><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":86,"i_eff":85,"i_reg":90,"cli":40,"hint_level":0,"session_complete":false}</telemetry>Minecraft stash boxes are a great way to see fractions in action! If one full slot holds 64 blocks and you have 32 blocks, what fraction of that slot is filled?`,
      command: null,
      fault: null
    };
  }

  if (/2x\s*\+\s*4\s*=\s*10/i.test(norm) || (/balance\s+scale/i.test(norm) && /equation/i.test(norm))) {
    return {
      text: `<hud>2x + 4 = 10 \\quad (\\text{Goal: Get } 2x \\text{ by itself on the left side})</hud><diagram>{"type":"balance_scale","title":"Equation Balance Scale: 2x + 4 = 10","left":"2x + 4","right":"10","caption":"Both sides weigh 10. Take 4 away from both sides so the scale stays balanced!"}</diagram><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":88,"i_eff":86,"i_reg":90,"cli":38,"hint_level":0,"session_complete":false}</telemetry>Picture this equation like a balanced scale with 2x plus 4 on the left and 10 on the right. To get the 2x part by itself while keeping both sides balanced, how many should we take away from both sides?`,
      command: null,
      fault: null
    };
  }

  if (isGraphRequestedByUser(norm)) {
    const spec = buildFallbackGraphSpec('', utterance);
    return {
      text: `<hud>${spec.functions[0]} = 0 \\quad (\\text{Where does the curve cross the flat } x\\text{-axis?})</hud><graph>${JSON.stringify(spec)}</graph><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":90,"i_eff":90,"i_reg":88,"cli":35,"hint_level":0,"session_complete":false}</telemetry>Here is the interactive graph of the function. Looking at the horizontal x-axis where height is zero, at what x numbers does the curve cross the line?`,
      command: null,
      fault: null
    };
  }

  // Section 15 Case 1: Physics Kinematics Micro-Diagnostic
  if (/final\s+velocity/i.test(norm) && /3\s*seconds|drops/i.test(norm)) {
    return {
      text: `<hud>\\text{Dropped Object: } t = 3\\text{ s},\\; v_i = 0 \\implies \\text{Find final speed } v_f \\text{ (What pulls it down?)}</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":80,"i_eff":80,"i_reg":90,"cli":83,"hint_level":0,"session_complete":false}</telemetry>We can definitely find that final speed! First, when an object drops in free fall, what force pulls it downward and how much speed does it gain each second?`,
      command: null,
      fault: null
    };
  }

  // Section 15 Case 2: Math Quadratics (2x^2 - 8x = 0) Micro-Diagnostic
  if (/2x\^2\s*-\s*8x\s*=\s*0/i.test(norm)) {
    return {
      text: `<hud>2x^2 - 8x = 0 \\quad (\\text{Goal: Find } x \\text{ where graph height } y = 0)</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":85,"i_reg":90,"cli":86,"hint_level":0,"session_complete":false}</telemetry>Let's find where the mix-up happens! When this equation equals zero, the height y on the graph is zero—what do we call the points where the curve crosses the flat horizontal x-axis?`,
      command: null,
      fault: null
    };
  }

  // Section 15 Case 3: Aborting Diagnostic on Student Stall (The Safety Net)
  if (/y-axis|y\s+axis/i.test(norm)) {
    return {
      text: `<hud>2x^2 - 8x = 0 \\implies 2x(\\text{?}) = 0 \\quad (\\text{What divides evenly into both } 2x^2 \\text{ and } 8x\\text{?})</hud><telemetry>{"step_tier":1,"delib_state":"COGNITIVE_STALL","i_flow":60,"i_eff":55,"i_reg":80,"cli":64,"hint_level":1,"session_complete":false}</telemetry>Close! Height zero is actually on the horizontal x-axis (the x-intercepts). Looking at 2x squared minus 8x, what biggest number and letter can divide evenly into both parts?`,
      command: null,
      fault: null
    };
  }

  if (/2x\^2\s*\+\s*5x\s*\+\s*2/i.test(norm) || /factoring/i.test(norm)) {
    return {
      text: `<hud>2x^2 + 5x + 2 = 0 \\quad (\\text{Goal: Find } x \\text{ where graph height } y = 0)</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":86,"i_eff":85,"i_reg":88,"cli":45,"hint_level":0,"session_complete":false}</telemetry>Before we tackle the numbers, let's check our starting point: when this equation equals zero, the height on the graph is zero—where on the horizontal x-axis are those points located?`,
      command: null,
      fault: null
    };
  }

  if (/derivative\s+of\s+x\s*(squared|\^2|2)/i.test(norm) || /instantaneous\s+rate/i.test(norm)) {
    if (modeId === 2) {
      return {
        text: `<hud>m_{\\text{sec}} = \\frac{\\text{Rise}}{\\text{Run}} = \\frac{f(x + h) - f(x)}{h}</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":88,"i_eff":86,"i_reg":90,"cli":55,"hint_level":0,"session_complete":false}</telemetry>Just so we start at the best spot: how do we find the steepness (rise over run) between two points on a curve before we slide them close together?`,
        command: null,
        fault: null
      };
    }
    return {
      text: `<hud>f(x) = x^2 \\implies f'(x) = \\text{Steepness (Slope) at } x</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":88,"i_eff":90,"i_reg":86,"cli":35,"hint_level":0,"session_complete":false}</telemetry>Before we calculate the derivative of x squared, what does the derivative tell us about how steep the curve is at any point x?`,
      command: null,
      fault: null
    };
  }

  return {
    text: `<hud>\\text{Problem Goal: Find the target value step by step}</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":84,"i_reg":86,"cli":42,"hint_level":0,"session_complete":false}</telemetry>Before we jump into the calculation, let's check our starting point: what numbers do we already know in this problem, and what are we trying to find?`,
    command: null,
    fault: null
  };
}

export const STEM_SCENARIOS = [
  {
    id: 'elem-minecraft-fractions',
    course: 'Grade 6–8 • Visual Fractions',
    title: '🧱 Minecraft Fractions (32 / 64 Slot)',
    modeRecommendation: 4,
    prompt: 'How do fractions work in real life using Minecraft stash boxes?'
  },
  {
    id: 'elem-balance-equation',
    course: 'Grade 6–8 • Visual Algebra',
    title: '⚖️ Balance Scale: 2x + 4 = 10',
    modeRecommendation: 1,
    prompt: 'Can you help me solve 2x + 4 = 10 using a balance scale?'
  },
  {
    id: 'diag-quadratics',
    course: 'Grade 10 • Math Diagnostic',
    title: '🧭 Quadratics: 2x² − 8x = 0',
    modeRecommendation: 1,
    prompt: 'I keep getting the wrong answer for 2x^2 - 8x = 0.'
  },
  {
    id: 'diag-kinematics',
    course: 'Grade 11 • Physics Diagnostic',
    title: '🧭 Free-Fall Velocity (t = 3s)',
    modeRecommendation: 4,
    prompt: 'How do I find the final velocity if it drops for 3 seconds?'
  },
  {
    id: 'graph-parabola',
    course: 'Interactive Graph • Grade 11 Functions',
    title: '📈 Graph & Inspect 2x² + 5x + 2',
    modeRecommendation: 1,
    prompt: 'Can you show me the graph of y = 2x^2 + 5x + 2 and help me find its roots and vertex?'
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
  }
];
