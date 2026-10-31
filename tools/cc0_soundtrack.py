#!/usr/bin/env python3
"""Replace only the four restricted music cues with documented CC0 audio.

No changes to gameplay, 3D assets, original source scripts, or the main-branch preview.
Requires ffmpeg and ffprobe (preinstalled on GitHub Actions ubuntu runners).
Run from repository root: python3 tools/cc0_soundtrack.py && python3 build.py
"""
import array
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
TRACKS = (
    {
        "name": "menu",
        "source": "https://opengameart.org/sites/default/files/prepare_to_fight.mp3",
        "destination": "dist/menu-theme.mp3",
        "max_seconds": None,
    },
    {
        "name": "victory",
        "source": "https://opengameart.org/sites/default/files/win-176035.mp3",
        "destination": "assets/sfx/fin/m_victory.mp3",
        "max_seconds": 5.0,
    },
    {
        "name": "defeat",
        "source": "https://opengameart.org/sites/default/files/Icy%20Game%20Over.mp3",
        "destination": "assets/sfx/fin/m_defeat.mp3",
        "max_seconds": 7.2,
    },
    {
        "name": "rank-up",
        "source": "https://opengameart.org/sites/default/files/fanfare1.mp3",
        "destination": "assets/rankup.mp3",
        "max_seconds": 4.0,
    },
)


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=True, **kwargs)


def download(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; CC0AudioBuild/1.0; +https://github.com/virus53111/Riposte-Frontline-Source)",
            "Accept": "audio/mpeg,application/octet-stream,*/*",
            "Referer": "https://opengameart.org/",
        },
    )
    with urllib.request.urlopen(req, timeout=75) as response:
        data = response.read(12_000_001)
    if len(data) > 12_000_000 or len(data) < 2048:
        raise ValueError(f"Unexpected download size from {url}: {len(data)}")
    if not (data[:3] == b"ID3" or (data[0] == 0xFF and data[1] & 0xE0 == 0xE0)):
        raise ValueError(f"Downloaded file is not an MP3: {url}")
    return data


def duration(path):
    p = run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    return float(p.stdout.strip())


def peak_index(path, seconds=2):
    """Peak sample at 48 kHz for the game's existing sample-alignment metadata."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
           "-t", str(seconds), "-ac", "1", "-ar", "48000", "-f", "s16le", "-"]
    raw = run(cmd, capture_output=True).stdout
    pcm = array.array("h")
    pcm.frombytes(raw[:len(raw) - len(raw) % 2])
    if not pcm:
        return 0
    return max(range(len(pcm)), key=lambda i: abs(pcm[i]))


def main():
    temp = ROOT / ".cc0-audio-tmp"
    temp.mkdir(exist_ok=True)
    meta = {"rate": 48000, "s": {}}
    try:
        for item in TRACKS:
            source = temp / (item["name"] + ".mp3")
            data = download(item["source"])
            source.write_bytes(data)
            output = ROOT / item["destination"]
            output.parent.mkdir(parents=True, exist_ok=True)
            cmd = [
                "ffmpeg", "-nostdin", "-y", "-v", "error",
                "-i", str(source), "-map_metadata", "-1",
                "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame",
                "-q:a", "4",
            ]
            if item["max_seconds"] is not None:
                cap = item["max_seconds"]
                cmd.extend(["-t", str(cap)])
                # Short end stingers get a gentle fade instead of cutting mid-note.
                cmd.extend(["-af", f"afade=t=out:st={max(0, cap-0.5)}:d=0.5"])
            cmd.append(str(output))
            run(cmd)
            seconds = duration(output)
            if seconds < 0.2:
                raise ValueError(f"Invalid converted audio: {output}")
            digest = hashlib.sha256(output.read_bytes()).hexdigest()[:16]
            print(f"{item['name']}: {output.relative_to(ROOT)} {seconds:.2f}s sha256:{digest}", flush=True)
            if item["name"] in ("victory", "defeat"):
                sid = "m_" + item["name"]
                meta["s"][sid] = [round(seconds * 48000), peak_index(output)]
        (ROOT / "assets/sfx/fin/meta.json").write_text(
            json.dumps(meta, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        print("All four original non-commercial music cues have been replaced in this build.", flush=True)
    finally:
        import shutil
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    main()
