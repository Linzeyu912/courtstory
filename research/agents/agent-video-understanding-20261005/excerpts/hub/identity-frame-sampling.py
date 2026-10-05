def _sample(start, end, count):
    count = min(count, end - start + 1)
    return sorted({start + round(i * (end - start) / max(1, count - 1)) for i in range(count)})

