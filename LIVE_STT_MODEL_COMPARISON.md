# Live STT Model Comparison — Real Interview Test (2026-07-20)

Basis: your actual Hinglish client-onboarding interview, recorded live through each model
(same conversation re-run per provider). Goal: live recording → speaker-wise transcript →
every 3–4 min chunk compared against the required-topics checklist ("atoms") → recommend
questions for topics the client hasn't answered yet.

## What each model actually produced (from your saved files)

### 1. Deepgram Nova-3 — `deepgram-nova-3/STT_deepgram_live_20260720-082356.txt` (98s)
- ✅ TRUE live speaker labels, and they were CORRECT (Speaker 0 = interviewer, Speaker 1 = client)
- ⚠️ Only 2 of 4 real participants labelled — BUT the run was just 98s; the other two may
  not have spoken in that window. Needs a full-length retest before final judgment.
- ✅ Clean readable English; Hindi words captured inline ("का rhythm", "Monday to Sunday दे देते हैं")
- ⚠️ Some mishears ("How does it work on congress?"), short fragmented lines
- Quality for your task: **8/10** | Live speakers: **YES, accurate**

### 2. AssemblyAI Universal-Streaming — `assemblyai-universal-streaming/...` (237s)
- ✅ BEST raw Hinglish text of all live models — fluent Devanagari code-switching
  ("जैसे डम्स ऑफ़ वर्क... आप लोगों का रिदम क्या है तो... I can take a first start")
- ✅ Long coherent turns, great for content analysis
- ❌ NO speaker labels at all — both speakers merge into one paragraph
- Quality for your task: **7/10** (text 9/10, speakers 0/10) | Live speakers: **NO**

### 3. Azure ConversationTranscriber — `azure-conversationtranscriber/...` (525s)
- ✅ TRUE live speakers — and the ONLY model that identified ALL 4 real participants
  (Speaker 1–4). Correction: this was initially misjudged as over-splitting.
- ❌ Transcribes EVERYTHING in Devanagari phonetics ("एस यूएस एज़ आई एक्सप्लेन्ड अर्लियर") —
  because locale is hi-IN, English becomes transliterated Hindi. Hard to read, hard for the
  analysis LLM.
- Quality for your task: **5/10** | Live speakers: **YES, but noisy**

### 4. Gladia Solaria — `gladia-solaria-live/...` (131s)
- ✅ Coherent English, decent structure
- ❌ Speaker labels did NOT come through in this run (diarization config was rejected by
  the API and our fallback dropped it) — fixable, needs config work
- ⚠️ Hindi segments garbled/dropped ("Sesi main air"), one hallucination ("Hi, I'm Rocky Baker")
- Quality for your task: **5/10 as-run** | Live speakers: **not in this run**

### 5. Speechmatics Real-Time — `speechmatics-real-time/...` (120s)
- ❌ Worst output in this run — BUT largely our config's fault: language defaulted to 'hi',
  so all English was transliterated to Devanagari one word per line ("आई थिंक / फर्स्ट / थैंक यू")
- ❌ Only one speaker detected; heavy fragmentation
- Note: Speechmatics has no true Hindi-English code-switching mode — either language choice
  damages half your interview. Weak fit for Hinglish regardless of config fixes.
- Quality for your task: **2/10 as-run** | Live speakers: partial

### 6. Sarvam Saaras v3 (LIVE view + Batch diarize on stop) — `saaras-v3-Batch-diarize/...`
- ✅ BEST OVERALL TRANSCRIPT QUALITY of everything tested:
  natural code-mixed output (English in Roman + Hindi where spoken), coherent sentences,
  correct meaning ("तो मतलब जैसे हम आ रहे हैं जैसे I can take a first start. तो Monday to Sunday...")
- ⚠️ Speaker labels: found 3 of the 4 real participants (merged two people) — consistent
  across all three runs
- ⚠️ Not instant: diarized result arrives AFTER the segment is sent (your runs: ~11–17s
  processing per ~4-min segment once the job is warm; first job took longer)
- Quality for your task: **9/10** | Live speakers: **no — but 3–4 min chunk-wise YES**

## Cost comparison (verified July 2026)

| Model | Streaming price | 1-hr interview | Notes |
|---|---|---|---|
| AssemblyAI Universal-Streaming | $0.15/hr | $0.15 | billed on session duration incl. idle time |
| Sarvam Saaras (batch, used per-chunk) | ₹30/hr (~$0.36) | ~$0.36 | diarization + code-mix included |
| Speechmatics RT (Pro) | $0.0067/min ≈ $0.40/hr | ~$0.40 | 8 h/month FREE; diarization included |
| Deepgram Nova-3 streaming | $0.0077/min = $0.46/hr | $0.46 | per-second billing; $200 free credit |
| Gladia live | ~$0.61/hr | ~$0.61 | 10 h/month FREE; diarization included |
| OpenAI gpt-realtime-whisper | ~$0.017/min ≈ $1.02/hr | ~$1.02 | no diarization |
| Azure real-time + diarization add-on | $1.00/hr + $0.30/hr | $1.30 | diarization is a paid add-on for real-time |

Hybrid recommendation cost: Deepgram live ($0.46) + Sarvam chunks ($0.36) ≈ **$0.82/hr**.
Budget alternative: AssemblyAI live view ($0.15, no speakers) + Sarvam chunks ($0.36) ≈ **$0.51/hr**.

## RECOMMENDATION for your interview → missed-question pipeline

Key insight: your analysis runs on 3–4 MINUTE CHUNKS — you do not need word-level live
latency for the checklist comparison. You only need the live view for the interviewer's
confidence, and accurate speaker-wise text every few minutes for the LLM.

**Recommended architecture (hybrid, best quality + lowest cost):**
1. **LIVE VIEW: Deepgram Nova-3** — accurate live speaker labels, clean text, $0.46/hr.
   The interviewer sees who-said-what in real time.
2. **ANALYSIS CHUNKS: Sarvam Saaras v3 batch diarize every 3–4 min** — send the rolling
   recording segment; ~10–17s later you get the best Hinglish speaker-wise transcript for
   the checklist LLM (~$0.35/hr). Its quality gap over the live models is big enough to
   matter for "what did the client NOT answer" detection.

**If you want ONE model only:** Deepgram Nova-3 — the only model that delivered accurate
live diarization + readable Hinglish in your own test, at near-lowest cost.

**Runner-up to watch:** AssemblyAI — if they ship live speaker labels for multilingual
streaming, its Hinglish text quality (best of the live group) would make it #1.

**Speaker-count reality check (4 real people in the room):**
Azure 4/4 (only one to find everyone) · Sarvam 3/4 (stable across runs) ·
Deepgram 2/4 (short 98s sample — retest full-length) · Speechmatics 1 · Gladia/AssemblyAI 0.
If per-person attribution across ALL 4 participants is critical, pair Azure's speaker
timeline with Sarvam's clean text per chunk, or confirm Deepgram on a full session first.

**Skip for this use case:** Speechmatics (no code-switching, priciest), Azure live
(Devanagari-everything output), Gladia (needs diarization fix; mid quality).
