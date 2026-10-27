# CAN-ON-SVS-01 // Socratic Voice System (ATA 100 FCOM Flight Deck)

Real-Time Multimodal Socratic Voice Agent engineered for **Ontario & Pan-Canadian Secondary STEM Education** (`Growing Success` assessment framework, strict Metric SI units).

## Implemented Specification Chapters

- **CH 00 — Airworthiness Directives & Operational Boundaries**:
  - Non-terminal intervention lock (zero final numeric answers or completed homework dumps).
  - Sub-400ms TTFA packet ceiling (`<= 40 words` per vocal burst).
  - Phonetic English math & SI orthography conversion (`dy/dx` $\rightarrow$ *"d y over d x"*, `x^2 - 4` $\rightarrow$ *"x squared minus 4"*).
- **CH 10 — Avionics & Vocal Profiles (Selectable Acoustic Emitters)**:
  - **Profile Alpha** ("The Veteran Captain" — 110 Hz, 135 wpm, warm/measured, Gemini Live voice `Charon`)
  - **Profile Bravo** ("The Lead Test Engineer" — 150 Hz, 155 wpm, crisp/analytical, Gemini Live voice `Puck`)
  - **Profile Charlie** ("The Flight Instructor" — 180 Hz, 150 wpm, dynamic/Socratic, Gemini Live voice `Aoede`)
  - **Profile Delta** ("The Mission Controller" — 120 Hz, 130 wpm, calm/deliberate, Gemini Live voice `Fenrir`)
- **CH 20 — Flight Modes (Routing Selector)**:
  - Boots in **Mode 1 (Standard Socratic Inquiry)** by default.
  - Supports instant vocal switching (`"Switch to Mode [1-4]"` with `< 6 words` verbal acknowledgement) or cockpit selector buttons across Modes 1–4.
- **CH 30 — Standard Operating Procedures (SOP) & Pre-Emission Sanitizer**:
  - Real-time telemetry for **1. Token/Word Audit (`<= 40 words`)**, **2. Orthography Check**, and **3. Preamble Sweep**.
- **CH 40 — Fault Isolation & Contingency Procedures**:
  - **Fault Code 401**: Student Cognitive Stall (`> 5s` silence watchdog or *"I don't know"*) $\rightarrow$ drops one diagnostic tier with a binary prompt.
  - **Fault Code 402**: Direct Answer Extortion (*"Just tell me the answer / do my homework"*) $\rightarrow$ locks flight controls to student thinking.
  - **Fault Code 403**: Conceptual Drift / Hallucination $\rightarrow$ immediate counter-factual intercept.

## Running the Flight Deck

```powershell
cd C:\Users\micha\.gemini\antigravity\scratch\can-on-svs-01
npx --yes serve -l 3000
```
Then open `http://localhost:3000` in Chrome or Edge.
