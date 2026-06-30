"""Chunk boundaries for late chunking.

Late chunking splits *after* encoding, so the chunker only decides token-index
windows; the store slices the already-computed token vectors and char offsets to
each window. Windows are fixed-size with overlap so a sentence straddling a
boundary still lands whole in one neighbouring chunk.
"""

CHUNK_TOKENS = 320
OVERLAP_TOKENS = 48


def windows(n_tokens: int) -> list[tuple[int, int]]:
    """Return [start, end) token-index ranges covering n_tokens with overlap."""
    if n_tokens <= 0:
        return []
    step = CHUNK_TOKENS - OVERLAP_TOKENS
    bounds = []
    start = 0
    while start < n_tokens:
        bounds.append((start, min(start + CHUNK_TOKENS, n_tokens)))
        if start + CHUNK_TOKENS >= n_tokens:
            break
        start += step
    return bounds
