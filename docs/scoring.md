# Scoring: importance × urgency

This is how `/triage` decides what to show you first. The operative rubric lives
in `.claude/skills/triage/SKILL.md`; this file is the *why*, with worked examples
and tuning notes.

## The model

Two independent axes, each 1–5:

- **Importance** = *who is this and what's at stake?* — about consequences, not
  time.
- **Urgency** = *how time-sensitive is it?* — about the clock, not the person.

**Priority = importance × urgency** (1–25). A newsletter with a "24h only!"
banner is urgent-feeling but importance 1, so it scores 5 and stays near the
bottom. Your cofounder asking a non-blocking question is importance 5 / urgency 2
= 10, above it. That separation is the whole point.

Tie-break: **oldest unanswered first** — among equal scores, the person who's
been waiting longest goes first.

## Classify, too: REPLY / TASK / NOISE

Scoring orders the queue; classification says what the chat *is*:

- **REPLY** — you need to *say* something. The agent drafts it in your voice.
- **TASK** — you need to *do* something first (often before you can reply). The
  agent states the concrete task and logs it to `tasks.md`.
- **NOISE** — no action needed; archive candidate.

Many chats are **REPLY + TASK**: "Can you send the deck?" → task: find/send deck;
reply once done (or a holding "sending this afternoon").

## Worked examples

| Chat | Imp | Urg | Score | Class | Why |
|------|----:|----:|------:|-------|-----|
| Partner: "are we still on for tonight? need to know by 5" | 5 | 5 | **25** | REPLY | Inner circle + hard deadline today. |
| Customer: "the integration is down in prod" | 5 | 5 | **25** | REPLY+TASK | Money/relationship + actively blocking them. |
| Cofounder: "thoughts on this hire? no rush" | 5 | 2 | **10** | REPLY | High stakes, no clock. |
| Friend mid-plan: "which day works for the trip?" | 4 | 4 | **16** | REPLY | Known person waiting on an answer soon. |
| Group chat, you're @-mentioned for a decision | 3 | 4 | **12** | REPLY | Addressed directly, others waiting. |
| Acquaintance: "great meeting you!" | 3 | 2 | **6** | REPLY | Nice-to-do, no pressure. |
| Group chatter not aimed at you | 2 | 1 | **2** | NOISE | Skim, no reply owed. |
| Substack digest / promo with countdown | 1 | 1 | **1** | NOISE | Urgent-*looking*, importance 1. |
| Uber/Amazon receipt | 1 | 1 | **1** | NOISE | Archive. |

## Tuning it to your life

- **Always-important people:** list them in `me.md` (or set importance in their
  `kb/<slug>.md`). The agent floors their importance so a one-word text from your
  partner never sorts below a vendor.
- **Quiet hours / channels you ignore:** note them in `me.md`; the agent can
  down-rank or skip those networks.
- **Your urgency reality:** if "this week" actually means "today" for you, say so
  in `me.md` and the agent will compress the urgency scale accordingly.
- **Noise patterns:** recurring senders you always archive — name them in `me.md`
  so they're auto-classified NOISE and offered as a one-OK batch.

The rubric is deliberately simple so its ranking is predictable and you learn to
trust it. Adjust the inputs (your `me.md` and KB), not the math.
