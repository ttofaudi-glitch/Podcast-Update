# Omaha Morning Brief

A five-minute spoken morning briefing (rates, markets, major companies, world events) that you can
read and listen to at the same time, with your listening history tracked.

## The app (`docs/`)

- **Briefing**: audio player, transcript that highlights each sentence as it is spoken, tap any sentence to
  jump there, section chips that tick off as you hear them, the day's numbers and sources.
- **Library**: every briefing, what you have heard (a bar shows exactly which parts), and a listening log.
- **Saved**: sections you bookmarked, with "Play from here".
- Works as an iPhone home-screen app: lock-screen controls, previous/next section buttons, resumes where you stopped.

Progress is stored on each device in the browser, so it does not sync between phone and computer.

## Install on iPhone

1. Open the GitHub Pages address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open it from the home-screen icon from then on (it keeps its own listening history).

## Make an episode

```bash
pip install -r requirements.txt
python3 build_episode.py docs/episodes/2026-10-16
```

See `CLAUDE.md` for the full production steps and editorial rules.
