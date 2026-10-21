# NoteFlow

An AI co-writer that starts from a musician's preferences, suggests chord progressions, song structures and lyric sketches, learns from every rating or change request, shows exactly how it changed, and drafts a split sheet for the collaborators.

**Live demo:** https://noteflow-j8af.onrender.com (free server, so the first visit can take about a minute to wake up)

**Hackathon:** State of the Art Hackathon 2026 (BASIX.MARKET)
**Track:** 02 Builders, MeTTa Foundation (Level 1)
**Challenge:** 2. The Agent That Grows Up: "Start with a small rule set and show it learning visibly. Show the diff."
**Partner brief we built toward:** Incantio, "a composing agent that learns a style and writes the split sheet". The partner brief is a proposal until Incantio confirms it.

## The problem

Musicians often struggle to develop ideas in their own style, and co-writers rarely write down who did what. NoteFlow suggests ideas, learns the musician's taste from feedback, explains every choice, and keeps a record of who kept which idea so the team can agree on splits early.

## Features

1. **Musical preference setup.** Pick a genre, a mood and a tempo. MeTTa turns them into a small starting rule set (about 7 rules).
2. **AI music composition.** Each idea has a 4-bar chord progression with real voicings, a song structure, and a 4-line lyric sketch. Press play to hear it in the browser.
3. **Feedback system.** Like, dislike, keep for the song, tap a change chip ("Darker chords", "Softer", "More energy", "New lyric theme"), or type a request like "make it sadder and slower". Reactions and change buttons sit right under the chords, grouped by Mood, Speed, Feel, Chords and Song, and **Undo** rolls the rules back one step.
4. **Adaptive learning agent.** Feedback changes the weights of MeTTa rules. New rules appear, unused ones are forgotten, and stances grow from `likes` to `loves`.
5. **Visible learning history.** After every piece of feedback, a **What NoteFlow just learned** panel shows each change in plain words ("Now likes dark chord progressions"), plus the idea before and after. The **What it learned** tab keeps the full history, with the MeTTa rule diff under "Under the hood". **Why NoteFlow picked this** explains every choice and which reaction shaped it.
6. **Split-sheet generator.** Song title, date, collaborators, roles, contribution notes and the shares the collaborators type in themselves. NoteFlow never assigns shares. **Check the split** uses MeTTa to verify the total is 100% and that everyone has a name, role and share. The sheet stays a draft until every collaborator ticks "Agreed", and editing a share clears the agreements. Download as Markdown or print to PDF.

### Easy to use

- **Try a quick demo** skips setup with a ready-made Lo-fi, melancholic taste and starts playing right away.
- The four most common changes (Darker, Brighter, Faster, Slower) are always visible. The rest are under **More options**.
- Keyboard shortcuts: <kbd>Space</kbd> play/stop, <kbd>L</kbd> like, <kbd>D</kbd> not for me, <kbd>K</kbd> keep, <kbd>U</kbd> undo, <kbd>N</kbd> new idea.
- Accessibility: labelled buttons and fields, spoken updates for screen readers, visible keyboard focus, 44px tap targets on phones, and reduced motion when the system asks for it.
- A GitHub Action (`.github/workflows/keep-awake.yml`) visits the live demo every 10 minutes so it doesn't fall asleep on the free plan.

## How MeTTa is used

| File | Role |
| --- | --- |
| `metta/hints.metta` | How a genre or mood maps to starting rules |
| `metta/logic.metta` | `setup`, `score`, `stance`, `rate`, `request`, `nudge` (learning with `remove-atom` / `add-atom`) |
| `metta/changes.metta` | What each change request does to the rules, and keywords for typed requests |
| `metta/splits.metta` | Contribution roles, plus `total` and `split-status` to check the shares add up to 100% |

Each idea has 7 features: mood, progression, harmony, rhythm, tempo, structure and theme. The agent writes 12 candidates, MeTTa scores each one, and the best is shown (about 15% of the time it explores a random one so it can learn something new). After a change request, the next idea is steered toward what was asked.

Example: set up as Lo-fi, Melancholic, 82 BPM, then ask for "Darker chords". The rule diff is:

```diff
+ (pref mood dark 1)
+ (pref progression bright -2)
+ (pref progression dark 2)
+ (dislikes progression bright)
+ (likes mood dark)
+ (likes progression dark)
```

The next idea is in a minor key with a dark progression, and "Why this idea" says the request shaped it.

Learned rules are saved in `data/learned.metta`, so the agent remembers between runs. "Reset to my preferences" goes back to the starting rules.

## Setup

Requires **Python 3.10, 3.11 or 3.12**. The `hyperon` package has no wheels for Python 3.13 yet.

Windows:

```bash
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

macOS / Linux:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Open http://127.0.0.1:5000. Follow the numbered tabs: **1 Your taste**, **2 Create**, **3 What it learned**, **4 Credits**.

## Deploy online

The repo includes `render.yaml`, so it deploys to Render's free plan in a few clicks:

1. Sign in at https://render.com with your GitHub account.
2. Click **New** → **Blueprint**, pick this repo, then **Apply**.
3. Wait for the build to finish and open the `.onrender.com` link.

Each visitor gets their own agent, kept by a browser cookie. On the free plan the server sleeps after 15 minutes without visitors, so the first visit after that can take up to a minute.

## Test

```bash
pytest
```

The tests cover setup rules, rating, change requests, typed request parsing, undo, saving and resetting, chord naming, request steering, the split-sheet check, and separate sessions for each visitor.

## Project structure

```
app.py          Flask API, one session per visitor
render.yaml     Render deployment settings
agent.py        MeTTa wrapper: setup, score, explain, learn, history, split sheet
composer.py     Chords, voicings, structures and lyric sketches
metta/          MeTTa rules and logic
static/         Web app (HTML, CSS, JS, Web Audio playback)
tests/          pytest tests
docs/           Video script
```

## Data and rights

All chords, structures and lyrics are generated by the code from built-in rules and word lists. No Incantio, AI for Peace, HFAS, or Harlem CLxR data is used. Split sheets are not legal advice. Shares are entered by the collaborators, and the sheet is a draft until every collaborator agrees and signs. The AI is disclosed and gets no share.

## What's next

- Learn combinations (for example "minor + slow") and melodies, not just single features.
- Export MIDI and stems with metadata so a finished track is ready to list on Incantio.
- One profile per musician, plus a shared band profile.
- Send signed splits to Incantio once the partner confirms the integration.

## Team

- Gerard Norielle Opsima (lead)
- Rufert Concepcion
- michaeledwin2004

## AI disclosure

See [AI_DISCLOSURE.md](AI_DISCLOSURE.md).
