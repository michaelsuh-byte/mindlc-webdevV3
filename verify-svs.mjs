import assert from 'node:assert/strict';
import {
  STEP_TIERS,
  FLIGHT_MODES,
  sanitizeLatexForHud,
  parseTriChannelPacket,
  isGraphRequestedByUser,
  buildFallbackGraphSpec,
  detectManimConsentIntent,
  computeRetroactiveAttribution,
  generateContextualCheckIn,
  generateFallbackLearningGapAnalysis,
  generateStage2ConceptOffer,
  generateNextQuestionPrompt,
  splitSpokenTextIntoClauses,
  analyzeStudentResponseAndEngagement,
  generateOfflineSocraticResponse,
  buildSystemInstruction,
  extractVisualQuestionFromSpoken,
  ensureExplicitHudLatex,
  summarizeStepKeyPoint,
  isInteractiveGraphNeeded,
  inferElementaryDiagramIfHelpful,
  verifyTalkingPointContinuity
} from './svs-engine.js';

import { compileMathExpression, findCurveFeatures } from './graph-engine.js';
import {
  isIncompleteSpokenClause,
  AudioAvionicsController,
  claimExclusiveVoiceChannel,
  releaseVoiceChannel,
  auditAndFixSimultaneousVoices
} from './audio-avionics.js';
import { normalizePcm16Buffer, GEMINI_TTS_MODELS } from './server.mjs';

// 1. Verify Strict Pre-KaTeX Screening Layer (`sanitizeLatexForHud`) strips ALL `$` signs
const dirtyHud = '<hud>$$a = 2$$, $b = 5$ and $c = 2$</hud>';
const screened = sanitizeLatexForHud(dirtyHud);
assert.equal(screened.includes('$'), false, 'Zero $ signs allowed in screened HUD LaTeX');
assert.equal(screened.includes('a = 2'), true);

// 2. Verify Multi-Channel Decoupling with <hud>, <graph>, <telemetry>, and spoken text
const rawQuadStream = `<hud>
$$2x^2 + 5x + 2 = 0$$
</hud>
<graph>{"title":"Quadratic Parabola","xDomain":[-6,4],"yDomain":[-4,10],"functions":[{"expr":"2*x^2 + 5*x + 2","label":"f(x) = 2x^2 + 5x + 2","color":"#60a5fa"}]}</graph>
<telemetry>{"step_tier":2,"delib_state":"DEEP_DELIBERATION","i_flow":91,"i_eff":89,"i_reg":93,"cli":48,"hint_level":0,"session_complete":true}</telemetry>
Here is the graph of the quadratic! Would you like to see a full Manim instructional video on this question?`;

const parsed = parseTriChannelPacket(rawQuadStream, 30);
assert.equal(parsed.hudLatex.includes('$'), false, 'Channel 1 <hud> LaTeX has zero $ signs');
assert.equal(parsed.spokenText.includes('$'), false, 'Channel 3 spoken text has zero $ signs');
assert.equal(parsed.spokenText.includes('<graph>'), false, 'Spoken text strips <graph> tags');
assert.equal(Boolean(parsed.graphSpec), true, 'Parsed <graph> specification');
assert.equal(parsed.graphSpec.functions[0].expr, '2*x^2 + 5*x + 2');
assert.equal(parsed.telemetry.session_complete, true, 'Parsed session_complete flag');

// 3. Verify Open-Source Graphing Engine Math Compiler & Feature Detection (roots/vertex/intercepts)
const fn = compileMathExpression('2*x^2 + 5*x + 2');
assert.equal(fn(0), 2, 'f(0) = 2');
assert.equal(fn(-2), 0, 'f(-2) = 0 root');
assert.equal(fn(-0.5), 0, 'f(-0.5) = 0 root');

const features = findCurveFeatures(fn, -5, 3);
const roots = features.filter(pt => pt.type === 'root');
assert.equal(roots.length, 2, 'Detects both roots (-2, 0) and (-0.5, 0)');

// 4. Verify Graph Request Detection & Fallback Graph Builder
assert.equal(isGraphRequestedByUser('Can you show me the graph of this parabola?'), true);
const fallbackGraph = buildFallbackGraphSpec('Show me the graph of y = x^2 - 4', 'x^2 - 4 = 0');
assert.equal(fallbackGraph.functions.length >= 1, true);

// 5. Verify Smart Speech Pause Detector Clause Awareness
assert.equal(
  isIncompleteSpokenClause('So first I multiplied the leading coefficient by the constant because'),
  true,
  'Recognizes trailing conjunction "because" as an incomplete spoken clause needing extra pause grace'
);
assert.equal(
  isIncompleteSpokenClause('The roots are negative two and negative one half.'),
  false,
  'Complete sentence does not trigger incomplete-clause extension'
);

// 6. Verify End-of-Session Manim Consent Intent Detection
assert.equal(detectManimConsentIntent('Yes please, show me the video!'), 'YES');
assert.equal(detectManimConsentIntent('No thanks, let us move on.'), 'NO');
assert.equal(detectManimConsentIntent('How do we factor x^2 - 9?'), null);

// 7. Verify Context-Aware Varied Check-Ins & System Prompt
const checkIn1 = generateContextualCheckIn({
  activeTier: 2,
  lastTutorQuestion: 'What two numbers multiply to four and add up to five?'
});
const checkIn2 = generateContextualCheckIn({
  activeTier: 2,
  lastTutorQuestion: 'What two numbers multiply to four and add up to five?'
});
assert.notEqual(checkIn1.spokenText, checkIn2.spokenText);

const sysPrompt = buildSystemInstruction('CHARLIE', 1, 30);
assert.equal(sysPrompt.includes('<graph>'), true, 'System prompt includes <graph> channel instructions');
assert.equal(sysPrompt.includes('session_complete'), true, 'System prompt includes session_complete video offer rule');
assert.equal(
  sysPrompt.includes('## 15. COLD-START BASELINE CALIBRATION (MICRO-DIAGNOSTIC PROBING)'),
  true,
  'System prompt includes Section 15 Micro-Diagnostic Probing specification'
);

// 8. Verify Mode-Adapted Diagnostic Focus across all 4 modes
for (const modeId of [1, 2, 3, 4]) {
  assert.equal(Boolean(FLIGHT_MODES[modeId].diagnosticFocus), true, `Mode ${modeId} defines diagnosticFocus`);
  assert.equal(Boolean(FLIGHT_MODES[modeId].progressionRule), true, `Mode ${modeId} defines progressionRule`);
  const mPrompt = buildSystemInstruction('CHARLIE', modeId, 30);
  assert.equal(mPrompt.includes(FLIGHT_MODES[modeId].diagnosticFocus), true);
}

// 9. Verify Section 15 Diagnostic Operational Examples (Case 1, Case 2, Case 3 Safety Net) with Explicit HUD & Plain Math-Literacy Phrasing
const case1 = parseTriChannelPacket(
  generateOfflineSocraticResponse('How do I find the final velocity if it drops for 3 seconds?', 4).text
);
assert.equal(case1.spokenText.includes('force pulls it downward'), true, 'Case 1 Kinematics Micro-Diagnostic uses plain math-literacy phrasing');
assert.equal(case1.hudLatex.includes('Find final speed'), true, 'Case 1 HUD explicitly states what is being asked');

const case2 = parseTriChannelPacket(
  generateOfflineSocraticResponse('I keep getting the wrong answer for 2x^2 - 8x = 0.', 1).text
);
assert.equal(case2.spokenText.includes('flat horizontal x-axis'), true, 'Case 2 Quadratics Micro-Diagnostic uses plain everyday language instead of jargon');
assert.equal(case2.hudLatex.includes('Goal: Find'), true, 'Case 2 HUD explicitly states the goal');

const case3 = parseTriChannelPacket(
  generateOfflineSocraticResponse('Uh... the y-axis?', 1).text
);
assert.equal(case3.telemetry.delib_state, 'COGNITIVE_STALL', 'Case 3 Safety Net tags COGNITIVE_STALL');
assert.equal(case3.telemetry.hint_level, 1, 'Case 3 Safety Net advances hint_level to 1');
assert.equal(case3.spokenText.includes('x-intercepts'), true, 'Case 3 Safety Net bridges to x-intercepts');

// 10. Verify Shortened Scratchpad Timer Limits (Tier 1 = 12s, Tier 2 = 15s, Tier 3 = 20s)
assert.equal(STEP_TIERS[1].expectedSec, 12, 'Tier 1 deliberation limit is 12 seconds');
assert.equal(STEP_TIERS[2].expectedSec, 15, 'Tier 2 deliberation limit is 15 seconds');
assert.equal(STEP_TIERS[3].expectedSec, 20, 'Tier 3 deliberation limit is 20 seconds');

// 11. Verify Behind-the-Scenes Learning-Gap Analysis & Stage 2 Concept Offer
const gapAnalysis = generateFallbackLearningGapAnalysis({
  lastHudLatex: '2x^2 + 5x + 2 = 0',
  lastTutorQuestion: 'What two numbers multiply to four and add up to five?',
  lastStudentMessage: 'How do I factor 2x^2 + 5x + 2 = 0?'
});
assert.equal(Boolean(gapAnalysis.missingConcept), true, 'Diagnoses missing concept behind the scenes');
assert.equal(Boolean(gapAnalysis.conceptExplanationSpoken), true, 'Generates concept explanation spoken text');
assert.equal(gapAnalysis.conceptExplanationHud.includes('$'), false, 'Concept explanation HUD has zero $ signs');

const stage2Offer = generateStage2ConceptOffer({
  activeTier: 2,
  gapAnalysis
});
assert.equal(stage2Offer.spokenText.toLowerCase().includes('explain'), true, 'Stage 2 offer suggests explaining the concept');
assert.equal(stage2Offer.telemetry.delib_state, 'COGNITIVE_STALL', 'Stage 2 offer updates telemetry to COGNITIVE_STALL');

// 12. Verify Default Speaking Speed is 1.1x and Generic Browser AI Voice Fallback is Removed
const testAvionics = new AudioAvionicsController();
assert.equal(testAvionics.customRateMultiplier, 1.1, 'Default speaking speed is set to 1.1x');
assert.equal(typeof testAvionics.speakBrowserFallback, 'undefined', 'Generic browser speechSynthesis fallback is completely removed');
assert.equal(testAvionics.getSelectedNeuralVoiceName('CHARLIE'), 'Aoede', 'Default voice is Aoede');

// 13. Verify Post-Video Varied Next-Question Prompts (`generateNextQuestionPrompt`)
const nextQ1 = generateNextQuestionPrompt('Step-by-Step Solution: Quadratic Roots');
const nextQ2 = generateNextQuestionPrompt('Step-by-Step Solution: Quadratic Roots');
const nextQ3 = generateNextQuestionPrompt('Step-by-Step Solution: Quadratic Roots');
assert.notEqual(nextQ1, nextQ2, 'Post-video follow-up prompts vary to avoid repetition');
assert.notEqual(nextQ2, nextQ3, 'Post-video follow-up prompts continue rotating');

// 14. Verify Option 4 Short First-Clause Splitter (`splitSpokenTextIntoClauses`)
const clauses = splitSpokenTextIntoClauses(
  'We can absolutely find that. Just to calibrate our instruments first: what is actually pulling the object down, and what is its acceleration?',
  30
);
assert.equal(clauses.length, 2, 'Splits into short opening clause and remainder');
assert.equal(clauses[0], 'We can absolutely find that.', 'First clause is short for instant TTS synthesis');
assert.equal(sysPrompt.includes('SELECTIVE USE ONLY'), true, 'System prompt enforces selective graph usage');

// 15. Verify Server-Side PCM16 RMS Volume Normalizer (`normalizePcm16Buffer`)
const quietBuf = Buffer.alloc(400);
const loudBuf = Buffer.alloc(400);
for (let i = 0; i < 200; i++) {
  const s = Math.sin(i * 0.2);
  quietBuf.writeInt16LE(Math.round(s * 3000), i * 2); // quiet (~0.09 peak)
  loudBuf.writeInt16LE(Math.round(s * 16000), i * 2); // loud (~0.49 peak)
}
const normQuiet = normalizePcm16Buffer(quietBuf, 0.18);
const normLoud = normalizePcm16Buffer(loudBuf, 0.18);
const calcRms = (buf) => {
  let sum = 0;
  for (let i = 0; i < buf.length / 2; i++) {
    const v = buf.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / (buf.length / 2));
};
assert.equal(Math.abs(calcRms(normQuiet) - calcRms(normLoud)) < 0.03, true, 'Quiet and loud TTS clips are normalized to consistent RMS loudness');

// 16. Verify Hard Mic Mute During Tutor Speech & Section 16 Topic Anchor / Clue-Gathering Gap Discovery
assert.equal(testAvionics.echoTailMs, 1000, 'Echo cooldown tail is set to 1000ms (+250ms OS buffer flush) so speaker tail finishes completely');
testAvionics.recordTutorSpokenFingerprint('Before doing the math, what graphical feature are we looking for when an equation equals zero?');
assert.equal(
  testAvionics.isLikelyTutorEcho('what graphical feature are we looking for when an equation equals zero'),
  true,
  'Speaker echo fingerprint filter rejects full tutor explanation bleed'
);
assert.equal(
  testAvionics.isLikelyTutorEcho('equals zero'),
  true,
  'Speaker echo fingerprint filter rejects last 2-word phrase of tutor explanation'
);
assert.equal(
  testAvionics.isLikelyTutorEcho('zero'),
  true,
  'Speaker echo fingerprint filter rejects last single word of tutor explanation'
);
assert.equal(
  testAvionics.stripTutorTailEcho('equals zero the x intercepts'),
  'the x intercepts',
  'stripTutorTailEcho strips leading tutor tail phrase while preserving student words'
);
assert.equal(
  testAvionics.isLikelyTutorEcho('the x intercepts'),
  false,
  'Speaker echo fingerprint filter allows genuine student answers'
);
testAvionics.engageSpeakerEchoLock();
assert.equal(testAvionics.recognitionPausedForPlayback, true, 'engageSpeakerEchoLock sets recognitionPausedForPlayback=true');
assert.equal(testAvionics.recognition, null, 'engageSpeakerEchoLock completely destroys SpeechRecognition instance while tutor speaks');
assert.equal(sysPrompt.includes('16. TOPIC ANCHOR, CLUE-GATHERING GAP DISCOVERY & GROUND-UP LOGICAL FLOW'), true, 'System prompt includes Section 16 Topic Anchor & Clue-Gathering rules');

const mcAnchor = 'What is a real-world application of fractions in Minecraft?';
const idkProbe = analyzeStudentResponseAndEngagement("I don't know", {
  activeTopicAnchor: mcAnchor,
  uncertaintyStreak: 0,
  lastTurnAskedForClue: false
});
assert.equal(idkProbe.engagementState, 'CLUE_GATHERING_PROBE', 'First "I don\'t know" triggers clue-gathering probe instead of guessing');
assert.equal(idkProbe.directive.includes(mcAnchor), true, 'Clue-gathering directive preserves active Minecraft fraction topic anchor');
assert.equal(idkProbe.nextAskedForClue, true);

const clueProvided = analyzeStudentResponseAndEngagement('I am confused about what the bottom number of the fraction means', {
  activeTopicAnchor: mcAnchor,
  uncertaintyStreak: idkProbe.nextUncertaintyStreak,
  lastTurnAskedForClue: idkProbe.nextAskedForClue
});
assert.equal(clueProvided.engagementState, 'CLUE_IDENTIFIED_FILL_GAP', 'Student reply after clue probe triggers Fill-the-Gap directive');
assert.equal(clueProvided.directive.includes(mcAnchor), true, 'Fill-the-Gap directive stays anchored to Minecraft fractions');

const offlineMcIdk = generateOfflineSocraticResponse("I don't know", 1, 'CHARLIE', {
  activeTopicAnchor: mcAnchor,
  lastHudLatex: '\\text{Stack Fraction} = \\frac{\\text{Items}}{64}'
});
assert.equal(/Minecraft stash boxes/i.test(offlineMcIdk.text), true, 'Offline "I don\'t know" stays anchored to Minecraft stash boxes and asks which part is confusing');

// 17. Verify Explicit HUD Question Extraction, Plain Math-Literacy Phrasing, and Elementary (Grade 6-8) Visual Aid <diagram> Channel
const mcPacket = parseTriChannelPacket(
  generateOfflineSocraticResponse('How do fractions work in real life using Minecraft stash boxes?', 4).text
);
assert.equal(Boolean(mcPacket.diagramSpec), true, 'Minecraft fraction response includes a <diagram> visual aid');
assert.equal(mcPacket.diagramSpec.type, 'fraction_bar', 'Minecraft fraction diagram is a fraction_bar');
assert.equal(mcPacket.hudQuestionText.endsWith('?'), true, 'Extracts explicit visual question for Left HUD Canvas');
assert.equal(mcPacket.spokenText.includes('<diagram>'), false, 'Strips <diagram> JSON from spoken audio');

const enrichedHud = ensureExplicitHudLatex('t = 3\\text{s}', 'What force pulls the object down and what is its final speed?', 'Free fall');
assert.equal(enrichedHud.includes('Find final speed'), true, 'Enriches brief/vague HUD with explicit target question');

const inferredBalance = inferElementaryDiagramIfHelpful('Can you help me solve 2x + 4 = 10?', '2x + 4 = 10', 'How many should we take away from both sides?', '2x + 4 = 10');
assert.equal(inferredBalance?.type, 'balance_scale', 'Infers balance_scale visual aid for elementary linear equation');

const noDiagramForCalc = inferElementaryDiagramIfHelpful('Find the derivative of x^2', 'f(x) = x^2', 'What is the derivative?', 'Calculus derivative');
assert.equal(noDiagramForCalc, null, 'Does not show elementary diagram when not needed');

// 18. Verify Concise Key-Point Step Summarizer (`summarizeStepKeyPoint`), Locked Demonstration Graph Default, & Persistent Tangent-Line-to-Parabola Graph
const keySummary = summarizeStepKeyPoint(
  '2x^2 - 8x = 0 \\quad (\\text{Goal: Find } x \\text{ where graph height } y = 0)',
  'Close! Height zero is actually on the horizontal x-axis (the x-intercepts). Looking at 2x squared minus 8x, what biggest number and letter can divide evenly into both parts?'
);
assert.equal(keySummary.keyMathLatex, '2x^2 - 8x = 0', 'Strips verbose parenthetical goal from keyMathLatex');
assert.equal(keySummary.keyPointText.split(/\s+/).length <= 11, true, 'Key point bullet is concise (<= 11 words)');

assert.equal(
  isGraphRequestedByUser('Why does the tangent line touch the parabola curve at only one point?'),
  false,
  'Follow-up question mentioning "parabola curve" does NOT falsely trigger a graph overwrite'
);
assert.equal(
  isInteractiveGraphNeeded('Show me the graph of a tangent line to a parabola'),
  false,
  'Demonstration graph defaults to locked/static (interactive: false)'
);
assert.equal(
  isInteractiveGraphNeeded('Can I trace the points on the graph to see what difference the parameter makes?'),
  true,
  'Interactive graph mode unlocks when student wants to trace points or test parameter changes'
);

const tangentGraph = buildFallbackGraphSpec(
  'f(x) = x^2',
  'Show me the graph of the tangent line to the parabola curve'
);
assert.equal(tangentGraph.functions.length, 2, 'Tangent-to-parabola graph plots both the parabola and tangent line');
assert.equal(tangentGraph.interactive, false, 'Tangent-to-parabola demonstration graph is locked by default');

const preservedOnFollowUp = buildFallbackGraphSpec(
  'f\'(1) = 2',
  'Why is the slope two at x = 1?',
  tangentGraph
);
assert.equal(preservedOnFollowUp.functions.length, 2, 'Existing session graph is preserved across follow-up turns without changing');

// 19. Verify Fuzzy End-of-Phrase Tail Echo Filtering & Talking-Point Verification Layer (`verifyTalkingPointContinuity`)
testAvionics.recordTutorSpokenFingerprint(
  'When this equation equals zero, what do we call the points where the curve crosses the flat horizontal x-axis?'
);
assert.equal(
  testAvionics.isLikelyTutorEcho('horizontal axis'),
  true,
  'Fuzzy tail word/stem filter catches STT-altered end-of-phrase echo ("horizontal axis" from "flat horizontal x-axis")'
);
assert.equal(
  testAvionics.stripTutorTailEcho('horizontal axis the x intercepts'),
  'the x intercepts',
  'Strips fuzzy tail echo prefix while keeping the student answer'
);

const echoGlitchCheck = verifyTalkingPointContinuity({
  utterance: 'horizontal axis',
  isFromVoice: true,
  talkingPointState: {
    stepNumber: 2,
    currentPointSummary: '2x^2 - 8x = 0 (Height zero on horizontal x-axis)',
    currentQuestionAsked: 'What do we call the points where the curve crosses the flat horizontal x-axis?',
    fullScriptText:
      'When this equation equals zero, the height y on the graph is zero—what do we call the points where the curve crosses the flat horizontal x-axis?',
    unspokenRemainderText: ''
  },
  activeTopicAnchor: 'Solve 2x^2 - 8x = 0'
});
assert.equal(
  echoGlitchCheck.shouldIgnoreAsEcho,
  true,
  'Talking-Point Verification Layer blocks late-phrase voice echo glitch before it can interrupt playback'
);

const validTurnVerification = verifyTalkingPointContinuity({
  utterance: 'They are called the x-intercepts',
  isFromVoice: true,
  talkingPointState: {
    stepNumber: 2,
    currentPointSummary: '2x^2 - 8x = 0 (Height zero on horizontal x-axis)',
    currentQuestionAsked: 'What do we call the points where the curve crosses the flat horizontal x-axis?',
    fullScriptText:
      'When this equation equals zero, the height y on the graph is zero—what do we call the points where the curve crosses the flat horizontal x-axis?',
    unspokenRemainderText: 'what do we call the points where the curve crosses the flat horizontal x-axis?'
  },
  activeTopicAnchor: 'Solve 2x^2 - 8x = 0'
});
assert.equal(validTurnVerification.shouldIgnoreAsEcho, false, 'Allows genuine student turn');
assert.equal(
  validTurnVerification.verificationDirective.includes('TALKING-POINT VERIFICATION LAYER'),
  true,
  'Generates Talking-Point Verification Layer directive for the LLM'
);
assert.equal(
  validTurnVerification.verificationDirective.includes('UNREAD SCRIPT RECOVERY'),
  true,
  'Includes unread script recovery directive if a clause was interrupted'
);

// 20. Verify Voice Integrity & Auto-Recovery Layer (Multi-Model TTS Failover Pool, Simultaneous Voice Guard, & Persona Drift Healer)
assert.equal(
  Array.isArray(GEMINI_TTS_MODELS) && GEMINI_TTS_MODELS.length >= 5,
  true,
  'Server maintains a 5-model Gemini Studio Neural TTS failover pool so quota limits never stop speech mid-session'
);

// Simulate two audio instances playing simultaneously and verify automatic collision fix
const mockAudio1 = {
  paused: false,
  ended: false,
  muted: false,
  volume: 1,
  src: 'blob:1',
  pause() {
    this.paused = true;
  }
};
const mockAudio2 = {
  paused: false,
  ended: false,
  muted: false,
  volume: 1,
  src: 'blob:2',
  pause() {
    this.paused = true;
  }
};
claimExclusiveVoiceChannel(mockAudio1, 'CHAT_1');
claimExclusiveVoiceChannel(mockAudio2, 'CHAT_2');
assert.equal(mockAudio1.paused, true, 'claimExclusiveVoiceChannel immediately stops any previous voice stream');
assert.equal(mockAudio1.muted, true, 'claimExclusiveVoiceChannel mutes displaced voice stream');
assert.equal(mockAudio2.paused, false, 'Latest voice stream remains active');
releaseVoiceChannel(mockAudio2);

// Verify persona drift healer restores Studio Neural Voice if an invalid/generic voice ID is ever set
testAvionics.selectedVoiceURI = 'Microsoft David Generic Desktop';
const healedVoice = testAvionics.getSelectedNeuralVoiceName('CHARLIE');
assert.equal(healedVoice, 'Aoede', 'Auto-heals generic/invalid voice URI back to Studio Neural Voice Aoede');
assert.equal(testAvionics.voiceIntegrityStats.personaDriftFixed >= 1, true, 'Records personaDriftFixed stat');

console.log('ALL VOICE INTEGRITY AUTO-RECOVERY, MULTI-MODEL TTS FAILOVER, AND TALKING-POINT VERIFICATION TESTS PASSED.');
