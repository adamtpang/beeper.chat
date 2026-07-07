# Launch content

Ready-to-post copy for beeper.chat. Voice: lowercase, confident, specific, no em
dashes, no emojis. Posting is the user's call (Rule 0 covers Beeper; identity
covers X/HN/Reddit). Nothing here is auto-posted.

---

## X / Twitter — build-in-public thread

**1/**
my beeper inbox had 100+ unread across whatsapp, imessage, signal, telegram and
discord. i kept answering the loudest chats instead of the ones that mattered,
and it never hit zero. so i built beeper.chat: an open-source AI that clears the
whole thing to zero by importance, not recency.

**2/**
it reads every unread chat across every network through beeper's local API,
scores each one importance x urgency from 1 to 25, and sorts it into one move:
reply, task, or noise. a partner's one-word text outranks a vendor's URGENT!!!
blast.

**3/**
then it drafts the reply in my voice and hands it back to me. i send, edit, or
skip. rule 0: it never sends, reacts, or archives without my explicit ok. it
drafts, i'm always the last click.

**4/**
the part i care about most: it runs locally on your own claude subscription. no
per-message api bill, no data leaving your machine. your chats stay on your box.

**5/**
it's a claude code skill plus a small local app. clone it, point it at beeper
desktop, run /beeper. free and open source, built in public with the beeper
community.
github.com/adamtpang/beeper.chat
beeper.chat

---

## Show HN

**Title** (under 80 chars):
Show HN: beeper.chat, inbox zero for Beeper ranked by importance x urgency

**Body:**
I use Beeper to unify WhatsApp, iMessage, Signal, Telegram and Discord into one
inbox, but I kept answering the loudest chats instead of the ones that mattered,
and it never hit zero.

beeper.chat is a Claude Code skill plus a small local app that clears it. It
reads every unread chat through Beeper Desktop's local API, scores each one on
importance x urgency from 1 to 25, and classifies it as a reply to send, a task
to do first, or noise. It surfaces the most important chat first with a reply
drafted in my voice.

Two design choices I care about:

- It never sends, reacts, or archives without my explicit OK. It drafts; I'm the
  last click.
- It runs on your own Claude subscription via Claude Code, so there's no
  per-message API bill, and your chats never leave your machine.

It's free and open source. Clone it, point it at Beeper Desktop, run /beeper.

Repo: https://github.com/adamtpang/beeper.chat
Site: https://beeper.chat

Would love feedback, especially from other Beeper users, on the scoring rubric
and what "importance" should mean.

---

## Beeper community (Matrix) + r/beeper

built something for fellow beeper power users: beeper.chat, an open-source claude
code skill that clears your inbox to zero by importance x urgency instead of
recency.

it reads every unread chat across all your networks through the local beeper
API, scores each one 1 to 25, sorts into reply / task / noise, and drafts the
reply in your voice. it never sends without your explicit ok, and it runs on
your own claude subscription so there's no api bill.

repo: github.com/adamtpang/beeper.chat
site: beeper.chat

would love your feedback on the scoring rubric and whether the local-API
approach holds up on your setup.
