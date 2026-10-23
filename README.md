# Hearth

[![pages-build-deployment](https://github.com/dmytr0x/typing/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/dmytr0x/typing/actions/workflows/pages/pages-build-deployment)

A calm, accuracy-first typing trainer for families and self-learners. Practice happens in the browser. There are no accounts, no cloud copy, and no rush.

**[Open the playground](https://dmytr0x.github.io/typing)**

## Who it is for

Hearth is built for people who want touch typing without a scoreboard shouting at them. It works well for:

- beginners starting from the home row
- returning learners who want a short daily session
- families sharing one computer, each with their own path

Choose a **reading band** when you create a learner: shorter reading for ages 10+, or everyday adult text. Daily goals default to 5 minutes (ages 10+) or 10 minutes (adult). Missed days have no penalty.

## Try it

1. Open the [playground](https://dmytr0x.github.io/typing).
2. Create a learner: nickname, reading band, and a companion avatar.
3. Confirm that the selected course matches the physical keyboard layout on your computer.
4. Follow the first-session walkthrough: posture, an unscored layout check, then either **New to touch typing** or an optional placement assessment.

Later days offer a short plan: warm-up, one new lesson, then familiar practice. You can pause, skip, or take one extra round whenever you like.

## Courses

Pick the course that matches the layout you actually type on. The live catalog currently includes:

| Course | Layout | What you learn |
| --- | --- | --- |
| English QWERTY | US QWERTY | Home row through letters, punctuation, numbers, and symbols |
| Українська · macOS | Apple Ukrainian (PC ISO) | Ukrainian letters, punctuation, and symbols on a Mac keyboard |

Each group of keys has a short sequence: meet the keys, find a rhythm, build connections, use your skills, then a checkpoint. Guided lessons wait for Backspace after a mistake; fluent practice lets you keep going and correct later.

Accuracy comes first. A lesson needs a complete submission of at least 100 characters and enough accuracy (typically 90–97%) to pass. Speed (WPM) is shown as correctly completed characters ÷ 5 ÷ active minutes; it is not required to unlock the next lesson.

## Practice beyond the course

The **Practice** page is for days when you do not want a new lesson:

- recommended keys from recent mistakes
- focused practice on keys you choose
- familiar words and sentences from keys you already know
- a timed assessment (pausing turns it into ordinary practice)
- your own saved passages

**Progress** shows completed lessons, dated trends, and a practice calendar. **Settings** covers daily minutes, finger hints, typing sounds, quiet practice (hides live speed), shorter exercises, text size, theme, and reduced motion.

## Progress stays on this computer

Hearth stores household data in this browser (IndexedDB). Family profiles share the device; there are no passwords.

Private windows, clearing site data, or browser eviction can lose progress. From **Settings** you can:

- export this learner or the whole household as JSON
- import a backup (add a new learner, replace the current one, or replace the household)
- request persistent browser storage (reduces eviction; it is not a backup)
- restore an unfinished attempt if a lesson was interrupted

Export a dated backup from time to time, especially before switching browsers or computers.

## Run it locally

The playground is the published static site. To try a local copy, serve this repository over HTTP (ES modules will not load from `file://`):

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).
