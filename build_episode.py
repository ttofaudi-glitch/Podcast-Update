"""Build one morning briefing episode: audio (MP3) plus a synced transcript page.

Usage:
    python3 build_episode.py episodes/2026-10-16

The episode folder must contain script.json. The build writes, into the same folder:
    briefing.mp3   the audio
    timings.json   start and end time of every sentence
    transcript.md  plain-text transcript
    index.html     self-contained player page (audio embedded, transcript highlights as it plays)

Speech is generated locally with Kokoro (open-weight text-to-speech model, runs on CPU).
"""

import base64
import html
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
MODEL_FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}
SENTENCE_GAP = 0.28  # seconds of silence between sentences
SECTION_GAP = 0.85   # seconds of silence between sections


def ensure_models():
    MODEL_DIR.mkdir(exist_ok=True)
    for name, url in MODEL_FILES.items():
        path = MODEL_DIR / name
        if not path.exists():
            print(f"Downloading {name} ...")
            urllib.request.urlretrieve(url, path)


def split_sentences(paragraph):
    # Split after . ! ? when the next sentence starts with a capital letter or a digit.
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9"“])', paragraph.strip())
    return [p.strip() for p in parts if p.strip()]


def to_speech(text):
    """Rewrite display text into a form the voice reads correctly."""
    s = text
    s = s.replace("S&P", "S and P")
    s = s.replace("&", " and ")
    s = re.sub(r"(\d),(\d{3})", r"\1\2", s)
    s = re.sub(r"(\d),(\d{3})", r"\1\2", s)
    s = re.sub(r"\$([\d.]+)\s*(million|billion|trillion)", r"\1 \2 dollars", s)
    s = re.sub(r"\$([\d.]+)", r"\1 dollars", s)
    s = re.sub(r"(\d)\s*%", r"\1 percent", s)
    s = re.sub(r"(\d)\s*[–-]\s*(\d)", r"\1 to \2", s)
    s = s.replace("—", ", ").replace("–", ", ")
    return s


def synthesize(script):
    from kokoro_onnx import Kokoro

    ensure_models()
    kokoro = Kokoro(str(MODEL_DIR / "kokoro-v1.0.onnx"), str(MODEL_DIR / "voices-v1.0.bin"))
    voice = script.get("voice", "af_heart")
    speed = float(script.get("speed", 1.0))

    chunks, timings, t, sr = [], [], 0.0, 24000
    for si, section in enumerate(script["sections"]):
        if si > 0:
            chunks.append(np.zeros(int(SECTION_GAP * sr), dtype=np.float32))
            t += SECTION_GAP
        for pi, paragraph in enumerate(section["paragraphs"]):
            for sentence in split_sentences(paragraph):
                samples, sr = kokoro.create(to_speech(sentence), voice=voice, speed=speed, lang="en-us")
                dur = len(samples) / sr
                timings.append({"section": si, "paragraph": pi, "text": sentence,
                                "start": round(t, 2), "end": round(t + dur, 2)})
                chunks.append(samples.astype(np.float32))
                chunks.append(np.zeros(int(SENTENCE_GAP * sr), dtype=np.float32))
                t += dur + SENTENCE_GAP
                print(f"  {t:6.1f}s  {sentence[:70]}")
    return np.concatenate(chunks), sr, timings


def encode_mp3(audio, sr, out_path):
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
        sf.write(wav.name, audio, sr)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav.name,
                        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                        "-ar", "24000", "-ac", "1", "-b:a", "64k", str(out_path)], check=True)


def write_transcript(script, out_path):
    lines = [f"# {script['title']}", "", f"_{script['dateline']}_", ""]
    for section in script["sections"]:
        lines += [f"## {section['heading']}", ""]
        for paragraph in section["paragraphs"]:
            lines += [paragraph, ""]
    lines += ["## Sources", ""]
    lines += [f"- [{s['title']}]({s['url']})" for s in script.get("sources", [])]
    out_path.write_text("\n".join(lines) + "\n")


def render_page(script, timings, mp3_path, out_path):
    e = html.escape
    by_para = {}
    for i, tm in enumerate(timings):
        by_para.setdefault((tm["section"], tm["paragraph"]), []).append((i, tm))

    sections_html = []
    for si, section in enumerate(script["sections"]):
        first = next(tm for tm in timings if tm["section"] == si)
        paras = []
        for pi in range(len(section["paragraphs"])):
            spans = " ".join(
                f'<span class="s" data-i="{i}" data-start="{tm["start"]}" data-end="{tm["end"]}">{e(tm["text"])}</span>'
                for i, tm in by_para[(si, pi)])
            paras.append(f"<p>{spans}</p>")
        sections_html.append(
            f'<section class="seg" data-start="{first["start"]}">'
            f'<h2><button class="jump" type="button" data-start="{first["start"]}">'
            f'<span class="ts">{int(first["start"] // 60)}:{int(first["start"] % 60):02d}</span>'
            f'{e(section["heading"])}</button></h2>{"".join(paras)}</section>')

    numbers_html = "".join(
        f'<tr><th scope="row">{e(n["label"])}</th><td class="v">{e(n["value"])}</td>'
        f'<td class="c {e(n.get("dir", "flat"))}">{e(n.get("change", ""))}</td></tr>'
        for n in script.get("numbers", []))
    sources_html = "".join(
        f'<li><a href="{e(s["url"])}" target="_blank" rel="noopener">{e(s["title"])}</a></li>'
        for s in script.get("sources", []))

    duration = timings[-1]["end"]
    audio_b64 = base64.b64encode(mp3_path.read_bytes()).decode()
    template = (ROOT / "template.html").read_text()
    page = (template
            .replace("{{TITLE}}", e(script["title"]))
            .replace("{{DATELINE}}", e(script["dateline"]))
            .replace("{{DURATION}}", f"{int(duration // 60)}:{int(duration % 60):02d}")
            .replace("{{SECTIONS}}", "\n".join(sections_html))
            .replace("{{NUMBERS}}", numbers_html)
            .replace("{{NUMBERS_NOTE}}", e(script.get("numbers_note", "")))
            .replace("{{SOURCES}}", sources_html)
            .replace("{{AUDIO_SRC}}", f"data:audio/mpeg;base64,{audio_b64}"))
    out_path.write_text(page)


def main():
    folder = Path(sys.argv[1]).resolve()
    script = json.loads((folder / "script.json").read_text())
    words = sum(len(p.split()) for s in script["sections"] for p in s["paragraphs"])
    print(f"Script: {words} words")

    audio, sr, timings = synthesize(script)
    mp3 = folder / "briefing.mp3"
    encode_mp3(audio, sr, mp3)
    (folder / "timings.json").write_text(json.dumps(timings, indent=1))
    write_transcript(script, folder / "transcript.md")
    render_page(script, timings, mp3, folder / "index.html")
    print(f"Done: {timings[-1]['end']:.0f} seconds of audio, {mp3.stat().st_size / 1e6:.1f} MB -> {folder}")


if __name__ == "__main__":
    main()
