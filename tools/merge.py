#!/usr/bin/env python3
"""Merge JSON array part files into one array file.
Usage: python3 tools/merge.py data/vocab-a1.json data/parts/vocab-a1.part*.json
Parts are concatenated in the order given (use zero-padded part numbers)."""
import json, sys
out, parts = sys.argv[1], sys.argv[2:]
merged = []
for p in sorted(parts):
    with open(p, encoding='utf-8') as fh:
        d = json.load(fh)
    if not isinstance(d, list):
        raise SystemExit(f'{p} is not an array')
    merged.extend(d)
with open(out, 'w', encoding='utf-8') as fh:
    json.dump(merged, fh, ensure_ascii=False, indent=1)
print(f'{out}: {len(merged)} items from {len(parts)} parts')
