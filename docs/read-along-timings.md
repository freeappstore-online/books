# Read-along timing data

The reader supports the existing sentence timings and optional word timestamps.
This does not change narration generation or require regenerating existing audio.
The same JSON works beside dataset audio and in community narration metadata:

```json
{
  "v": 1,
  "segments": [[0, 11, 0, 6]],
  "words": [[0, 4, 0.3, 4], [5, 11, 4.5, 5.5]]
}
```

Each tuple is `[charStart, charEnd, startSeconds, endSeconds]`. Character offsets
are UTF-16 indices into the chapter content, with an exclusive end. Both arrays
must be ordered and non-overlapping, with positive time spans. Word timestamps
must lie within their sentence's text and time bounds. Include every spoken word
of an aligned sentence; sentence-only portions can omit word timestamps.

When word timestamps are present, highlighting and tap-to-seek use them directly.
The word highlight clears during measured pauses. Otherwise, the reader estimates
word positions from each sentence's duration and syllable counts; those estimates
are not exact word alignment. Invalid sentence data disables read-along without
interrupting audio. Invalid optional word data falls back to sentence estimates.

Publishing exact word timestamps is a separate generation/alignment task. The
current sentence-based generators remain unchanged.

Offline saves include timing metadata. When a manifest advertises timings that a
saved book lacks, My books offers **Update (read-along)** without downloading the
existing audio again. Legacy manifests that do not declare timing availability
do not produce speculative update prompts.
