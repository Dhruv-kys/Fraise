
CHUNK_TOKENS = 320
OVERLAP_TOKENS = 48

def windows(n_tokens: int) -> list[tuple[int, int]]:
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
