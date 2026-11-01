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
  generateOfflineSocraticResponse,
  buildSystemInstruction
} from './svs-engine.js';

import { compileMathExpression, findCurveFeatures } from './graph-engine.js';
import { isIncompleteSpokenClause, AudioAvionicsController } from './audio-avionics.js';

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

console.log('ALL SECTION 15 MICRO-DIAGNOSTIC, TWO-STAGE TIMER (15s), LEARNING-GAP ANALYZER, AND AOEDE 1.1X VOICE TESTS PASSED.');
