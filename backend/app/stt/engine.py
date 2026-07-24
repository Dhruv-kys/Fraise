import logging
import os
import threading

import numpy as np

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("STT_MODEL", "large-v3-turbo")
DEVICE = os.getenv("STT_DEVICE", "auto")
COMPUTE = os.getenv("STT_COMPUTE", "int8")

SAMPLE_RATE = 16_000

_HALLUCINATIONS = {
    "thank you",
    "thanks for watching",
    "thank you for watching",
    "thank you so much for watching",
    "please subscribe",
    "subtitles by the amara.org community",
    "you",
}

_model = None
_load_lock = threading.Lock()
_transcribe_lock = threading.Lock()


def is_loaded() -> bool:
    return _model is not None


def load():
    global _model
    with _load_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            logger.info("loading STT model %s (device=%s compute=%s)", MODEL_NAME, DEVICE, COMPUTE)
            _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
    return _model


def transcribe(
    audio: np.ndarray,
    context: str = "",
    hints: list[str] | None = None,
    language: str | None = None,
) -> str:
    model = load()
    prompt_parts = []
    if hints:
        prompt_parts.append(", ".join(hints) + ".")
    if context:
        prompt_parts.append(context[-200:])
    prompt = " ".join(prompt_parts) or None

    with _transcribe_lock:
        segments, _info = model.transcribe(
            audio,
            language=language,
            beam_size=5,
            temperature=[0.0, 0.2, 0.4],
            initial_prompt=prompt,
            condition_on_previous_text=False,
            no_speech_threshold=0.55,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.4,
        )
        parts = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            if seg.no_speech_prob > 0.75 and seg.avg_logprob < -0.8:
                continue
            unsure = seg.no_speech_prob > 0.4 or len(audio) < 1.5 * SAMPLE_RATE
            if unsure and text.lower().strip(" .!?") in _HALLUCINATIONS:
                continue
            parts.append(text)
    return " ".join(parts).strip()
