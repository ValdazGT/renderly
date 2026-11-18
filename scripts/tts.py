#!/usr/bin/env python3
"""Edge TTS helper for renderly: one mp3 + word-level timings per narration chunk."""
import argparse
import asyncio
import json
import sys

import edge_tts


def spread_words(text, sentences):
    """Fallback: turunkan timing kata dari timing kalimat kalau voice tidak mengirim WordBoundary."""
    words = []
    remaining = list(sentences)
    for sentence in remaining:
        parts = [w for w in sentence["text"].split() if w]
        if not parts:
            continue
        weights = [len(w) + 1 for w in parts]
        total = sum(weights)
        start = sentence["t"]
        duration = max(0.001, sentence["d"])
        cursor = start
        for part, weight in zip(parts, weights):
            step = duration * (weight / total)
            words.append({"w": part, "t": round(cursor, 4), "d": round(step, 4)})
            cursor += step
    return words


async def synth(text, out_mp3, out_words, voice, rate, pitch, volume):
    last_error = None
    for attempt in range(3):
        words = []
        sentences = []
        try:
            communicate = edge_tts.Communicate(
                text,
                voice,
                rate=rate,
                pitch=pitch,
                volume=volume,
                boundary="WordBoundary",
            )
            with open(out_mp3, "wb") as handle:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        handle.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        words.append(
                            {
                                "w": chunk["text"],
                                "t": round(chunk["offset"] / 10_000_000, 4),
                                "d": round(chunk["duration"] / 10_000_000, 4),
                            }
                        )
                    elif chunk["type"] == "SentenceBoundary":
                        sentences.append(
                            {
                                "text": chunk["text"],
                                "t": round(chunk["offset"] / 10_000_000, 4),
                                "d": round(chunk["duration"] / 10_000_000, 4),
                            }
                        )
            if not words and sentences:
                words = spread_words(text, sentences)
            if not words:
                raise RuntimeError("edge-tts tidak mengirim boundary")
            with open(out_words, "w", encoding="utf-8") as handle:
                json.dump({"voice": voice, "text": text, "words": words}, handle, ensure_ascii=False)
            return
        except Exception as error:  # noqa: BLE001
            last_error = error
            await asyncio.sleep(1.2 * (attempt + 1))
    raise SystemExit(f"tts gagal: {last_error}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--words", required=True)
    parser.add_argument("--voice", default="id-ID-ArdiNeural")
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    parser.add_argument("--volume", default="+0%")
    args = parser.parse_args()

    with open(args.text_file, encoding="utf-8") as handle:
        text = handle.read().strip()

    if not text:
        raise SystemExit("teks kosong")

    asyncio.run(synth(text, args.out, args.words, args.voice, args.rate, args.pitch, args.volume))


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(1)