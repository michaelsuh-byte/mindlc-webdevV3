import assert from 'node:assert/strict';
import {
  parseDualChannelPacket,
  sanitizeForSpeech,
  detectSystemCommand,
  detectFaultCondition,
  generateOfflineSocraticResponse,
  buildSystemInstruction
} from './svs-engine.js';

// 1. Test SB-02 Example 01 (Quadratic Factoring Dual-Stream)
const ex1Raw = `<hud>
$$2x^2 + 5x + 2 = 0$$
</hud>
Look at the lead coefficient and the constant. What two numbers multiply to four and add up to five?`;

const parsed1 = parseDualChannelPacket(ex1Raw, 30);
assert.equal(parsed1.hudLatex, '2x^2 + 5x + 2 = 0', 'HUD LaTeX extracted cleanly');
assert.equal(parsed1.spokenText.includes('2x'), false, 'HUD math never leaks into spoken audio channel');
assert.equal(
  parsed1.spokenText,
  'Look at the lead coefficient and the constant. What two numbers multiply to four and add up to five?'
);
assert.equal(parsed1.audit.finalWordCount <= 30, true, 'Spoken burst <= 30 words');

// 2. Test SB-02 Example 02 (First Principles Derivative Dual-Stream)
const ex2Raw = `<hud>
$$m_{sec} = \\frac{(x + h)^2 - x^2}{h}$$
</hud>
Expand that numerator on your instrument panel. What terms cancel out?`;

const parsed2 = parseDualChannelPacket(ex2Raw, 30);
assert.equal(parsed2.hudLatex.includes('\\frac{(x + h)^2 - x^2}{h}'), true);
assert.equal(parsed2.spokenText.includes('\\frac'), false, 'No \\frac in spoken channel');
assert.equal(parsed2.spokenText.includes('<hud>'), false, 'No <hud> tag in spoken channel');

// 3. Test sanitizeForSpeech directly when raw string still contains <hud>
const directSanitized = sanitizeForSpeech('<hud>$$f(x) = \\frac{\\sqrt{x - 2}}{x^2 - 9}$$</hud> Plug negative three into the radical and report what happens.', 30);
assert.equal(directSanitized.hudStripped, true);
assert.equal(directSanitized.cleanText.includes('sqrt'), false);

// 4. Test System Instruction includes Service Bulletin SB-02 Dual-Channel protocol
const sysPrompt = buildSystemInstruction('CHARLIE', 2, 30);
assert.equal(sysPrompt.includes('<hud>'), true);
assert.equal(sysPrompt.includes('DUAL-CHANNEL TELEMETRY'), true);

console.log('ALL SERVICE BULLETIN CAN-ON-SVS-SB-02 DUAL-CHANNEL CHECKS PASSED.');
