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
  buildSystemInstruction
} from './svs-engine.js';

import { compileMathExpression, findCurveFeatures } from './graph-engine.js';
import { isIncompleteSpokenClause, AudioAvionicsController } from './audio-avionics.js';
import { normalizePcm16Buffer } from './server.mjs';

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

// 9. Verify Section 15 Diagnostic Operational Examples (Case 1, Case 2, Case 3 Safety Net)
const case1 = parseTriChannelPacket(
  generateOfflineSocraticResponse('How do I find the final velocity if it drops for 3 seconds?', 4).text
);
assert.equal(case1.spokenText.includes('calibrate our instruments'), true, 'Case 1 Kinematics Micro-Diagnostic');

const case2 = parseTriChannelPacket(
  generateOfflineSocraticResponse('I keep getting the wrong answer for 2x^2 - 8x = 0.', 1).text
);
assert.equal(case2.spokenText.includes('what graphical feature'), true, 'Case 2 Quadratics Micro-Diagnostic');

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

// 16. Verify Warm Mic Resume & Section 16 Topic Anchor / Clue-Gathering Gap Discovery
assert.equal(testAvionics.echoTailMs, 180, 'Echo cooldown tail is set to 180ms for instant mic resume');
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

console.log('ALL MIC TURN-TAKING, INSTANT MIC RESUME, MULTI-TURN PERFORMANCE, AND SECTION 16 TOPIC-ANCHOR CLUE-GATHERING TESTS PASSED.');
