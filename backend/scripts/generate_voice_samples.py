"""One-time generator for the voice-picker's audio previews.

Calls Deepgram's TTS REST API for each curated voice with the same line
("Hi, I'm Fraise.") and saves the result to frontend/public/voices/<id>.mp3,
where the VoicePicker in App.tsx plays it from. Run this once whenever the
curated voice list (frontend/src/voices.ts) changes:

    python backend/scripts/generate_voice_samples.py

Requires DEEPGRAM_API_KEY in the repo-root .env (same one the backend loads).
"""
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
import os

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

VOICE_IDS = [
    "aura-2-thalia-en",
    "aura-2-apollo-en",
    "aura-2-luna-en",
    "aura-2-orion-en",
    "aura-2-aurora-en",
    "aura-2-zeus-en",
    "aura-2-athena-en",
    "aura-2-draco-en",
    "aura-2-hera-en",
    "aura-2-atlas-en",
]

SAMPLE_LINE = "Hi, I'm Fraise."
OUT_DIR = ROOT / "frontend" / "public" / "voices"

def main() -> None:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print("DEEPGRAM_API_KEY is not set (checked .env at repo root).", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    headers = {"Authorization": f"Token {api_key}", "Content-Type": "application/json"}

    with httpx.Client(timeout=30) as client:
        for voice_id in VOICE_IDS:
            out_path = OUT_DIR / f"{voice_id}.mp3"
            resp = client.post(
                "https://api.deepgram.com/v1/speak",
                params={"model": voice_id, "encoding": "mp3"},
                headers=headers,
                json={"text": SAMPLE_LINE},
            )
            if resp.status_code != 200:
                print(f"FAILED {voice_id}: {resp.status_code} {resp.text[:200]}", file=sys.stderr)
                continue
            out_path.write_bytes(resp.content)
            print(f"wrote {out_path.relative_to(ROOT)} ({len(resp.content)} bytes)")

if __name__ == "__main__":
    main()
