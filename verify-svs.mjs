import assert from 'node:assert/strict';
import {
  STEP_TIERS,
  sanitizeLatexForHud,
  parseTriChannelPacket,
  isGraphRequestedByUser,
  buildFallbackGraphSpec,
  detectManimConsentIntent,
  computeRetroactiveAttribution,
  generateContextualCheckIn,
  buildSystemInstruction
} from './svs-engine.js';

import { compileMathExpression, findCurveFeatures } from './graph-engine.js';
import { isIncompleteSpokenClause } from './audio-avionics.js';

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
assert.equal(sysPrompt.includes('session_complete'), true, 'System prompt includes session_complete Manim video offer rule');

console.log('ALL GRAPH ENGINE, PAUSE DETECTOR, MANIM VIDEO, AND TRI-CHANNEL TESTS PASSED.');
