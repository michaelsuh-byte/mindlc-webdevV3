import assert from 'node:assert/strict';
import {
  STEP_TIERS,
  sanitizeLatexForHud,
  parseTriChannelPacket,
  computeRetroactiveAttribution,
  generateContextualCheckIn,
  sanitizeForSpeech,
  buildSystemInstruction
} from './svs-engine.js';

// 1. Verify Strict Pre-KaTeX Screening Layer (`sanitizeLatexForHud`) strips ALL `$` signs
const dirtyHud = '<hud>$$a = 2$$, $b = 5$ and $c = 2$</hud>';
const screened = sanitizeLatexForHud(dirtyHud);
assert.equal(screened.includes('$'), false, 'Zero $ signs allowed in screened HUD LaTeX');
assert.equal(screened.includes('a = 2'), true);

// 2. Verify Tri-Channel Decoupling with internal $ signs inside <hud> and spoken text
const rawTriStream = `<hud>
$$2x^2 + 5x + 2 = 0$$
$a = 2$, $c = 2$
</hud>
<telemetry>{"step_tier":2,"delib_state":"DEEP_DELIBERATION","i_flow":91,"i_eff":89,"i_reg":93,"cli":48,"hint_level":0}</telemetry>
Look at the leading coefficient $a$ and the constant $c$. What two numbers multiply to four and add up to five?`;

const parsed = parseTriChannelPacket(rawTriStream, 30);
assert.equal(parsed.hudLatex.includes('$'), false, 'Channel 1 <hud> LaTeX has zero $ signs');
assert.equal(parsed.spokenText.includes('$'), false, 'Channel 3 spoken text has zero $ signs');
assert.equal(parsed.telemetry.step_tier, 2);
assert.equal(parsed.telemetry.delib_state, 'DEEP_DELIBERATION');

// 3. Verify Realistic Deliberation Latency Envelopes
assert.equal(STEP_TIERS[1].expectedSec, 15, 'Tier 1 t_expected = 15s');
assert.equal(STEP_TIERS[2].expectedSec, 25, 'Tier 2 t_expected = 25s');
assert.equal(STEP_TIERS[3].expectedSec, 45, 'Tier 3 t_expected = 45s');

// 4. Verify Context-Aware Varied Check-Ins
const checkInFactor1 = generateContextualCheckIn({
  activeTier: 2,
  lastTutorQuestion: 'What two numbers multiply to four and add up to five?'
});
const checkInFactor2 = generateContextualCheckIn({
  activeTier: 2,
  lastTutorQuestion: 'What two numbers multiply to four and add up to five?'
});
assert.notEqual(
  checkInFactor1.spokenText,
  checkInFactor2.spokenText,
  'Consecutive check-ins vary naturally instead of repeating the same sentence'
);

const checkInConcept = generateContextualCheckIn({
  activeTier: 1,
  lastTutorQuestion: 'Why does the horizontal velocity stay constant while in the air?'
});
assert.equal(
  /think|intuition|hunch|rephrase|hint/i.test(checkInConcept.spokenText),
  true,
  'Conceptual question triggers a thinking/intuition check-in rather than assuming paper calculation'
);

// 5. Verify Retroactive Attribution
const deepDelib = computeRetroactiveAttribution('I factored it into (2x + 1)(x + 2)', 20, 2, 0);
assert.equal(deepDelib.delib_state, 'DEEP_DELIBERATION');

const cogStall = computeRetroactiveAttribution("I don't know", 15, 2, 0);
assert.equal(cogStall.delib_state, 'COGNITIVE_STALL');
assert.equal(cogStall.hint_level, 1);

// 6. Verify System Instruction forbids $ signs inside <hud>
const sysPrompt = buildSystemInstruction('CHARLIE', 1, 30);
assert.equal(sysPrompt.includes('WITHOUT any `$` or `$$` dollar signs'), true);

console.log('ALL LATEX SCREENING, TIMER CONTROLS, COMPACT UI, AND CONTEXTUAL CHECK-IN TESTS PASSED.');
