# Podcast-Update

A five-minute spoken morning briefing (markets, the economy, major companies, world events),
with a transcript page that highlights each sentence as the audio plays.

## Build an episode

```bash
pip install kokoro-onnx soundfile        # local text-to-speech, runs on CPU
python3 build_episode.py episodes/2026-10-16
```

Each episode folder holds `script.json` (the text, the numbers table and the sources).
The build writes `briefing.mp3`, `timings.json`, `transcript.md` and `index.html`
(a self-contained page with the audio embedded). Voice model files download to `models/` on first run.
