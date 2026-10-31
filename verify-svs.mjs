import assert from 'node:assert/strict';
import {
  STEP_TIERS,
  parseTriChannelPacket,
  computeRetroactiveAttribution,
  generateScratchpadSoftPing,
  sanitizeForSpeech,
  buildSystemInstruction
} from './svs-engine.js';

// 1. Verify Section 00 & 20 Tri-Channel Decoupling (<hud> + <telemetry> + Spoken Audio)
const rawTriStream = `<hud>
$$2x^2 + 5x + 2 = 0$$
</hud>
<telemetry>{"step_tier":2,"delib_state":"DEEP_DELIBERATION","i_flow":91,"i_eff":89,"i_reg":93,"cli":48,"hint_level":0}</telemetry>
Look at the leading coefficient and the constant. What two numbers multiply to four and add up to five?`;

const parsed = parseTriChannelPacket(rawTriStream, 30);
assert.equal(parsed.hudLatex, '2x^2 + 5x + 2 = 0', 'Channel 1 <hud> LaTeX extracted');
assert.equal(parsed.telemetry.step_tier, 2, 'Channel 2 <telemetry> step_tier extracted');
assert.equal(parsed.telemetry.delib_state, 'DEEP_DELIBERATION', 'Channel 2 delib_state extracted');
assert.equal(parsed.telemetry.i_flow, 91, 'Channel 2 i_flow extracted');
assert.equal(parsed.spokenText.includes('<hud>'), false, 'No <hud> in spoken channel');
assert.equal(parsed.spokenText.includes('<telemetry>'), false, 'No <telemetry> in spoken channel');
assert.equal(parsed.spokenText.includes('delib_state'), false, 'No JSON keys in spoken channel');
assert.equal(
  parsed.spokenText,
  'Look at the leading coefficient and the constant. What two numbers multiply to four and add up to five?'
);

// 2. Verify Section 10 Complexity Indexing (Expected Latency Envelopes)
assert.equal(STEP_TIERS[1].expectedSec, 5, 'Tier 1 t_expected = 5s');
assert.equal(STEP_TIERS[2].expectedSec, 20, 'Tier 2 t_expected = 20s');
assert.equal(STEP_TIERS[3].expectedSec, 45, 'Tier 3 t_expected = 45s');

// 3. Verify Section 10.2 Non-Intrusive Soft-Ping
const softPing = generateScratchpadSoftPing(2, '$$(x + h)^2 - x^2$$');
assert.equal(softPing.telemetry.delib_state, 'SCRATCHPAD_ACTIVE');
assert.equal(
  softPing.spokenText,
  'Take your time with the paper calculation. Let me know when you expand that bracket.'
);

// 4. Verify Section 10.3 Retroactive Attribution
const deepDelib = computeRetroactiveAttribution('I expanded it to 2x^2 + 4x + x + 2', 18, 2, 0);
assert.equal(deepDelib.delib_state, 'DEEP_DELIBERATION', 'Long pause + structured response -> DEEP_DELIBERATION');
assert.equal(deepDelib.i_flow >= 85, true);

const cogStall = computeRetroactiveAttribution("I don't know", 15, 2, 0);
assert.equal(cogStall.delib_state, 'COGNITIVE_STALL', 'Blockage response -> COGNITIVE_STALL');
assert.equal(cogStall.hint_level, 1, 'Triggers Hint Ladder Level 1');

// 5. Verify sanitizeForSpeech strips both <hud> and <telemetry>
const directSanitized = sanitizeForSpeech(
  '<hud>$$x^2$$</hud><telemetry>{"step_tier":1,"delib_state":"IMMEDIATE","i_flow":85,"i_eff":85,"i_reg":85,"cli":35,"hint_level":0}</telemetry>What happens to the exponent?',
  30
);
assert.equal(directSanitized.hudStripped, true);
assert.equal(directSanitized.telemetryStripped, true);
assert.equal(directSanitized.cleanText, 'What happens to the exponent?');

// 6. Verify System Instruction contains Section 00, 10, and 20 directives
const sysPrompt = buildSystemInstruction('CHARLIE', 1, 30);
assert.equal(sysPrompt.includes('<telemetry>'), true);
assert.equal(sysPrompt.includes('DEEP_DELIBERATION'), true);

console.log('ALL TRI-CHANNEL (<hud>, <telemetry>, AUDIO) & SCRATCHPAD DELIBERATION CHECKS PASSED.');
