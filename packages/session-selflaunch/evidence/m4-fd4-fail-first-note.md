# M4 F-D4 fail-first

This immutable log was captured on clean head `3cd80383b` before the F-D4 repair. The PATH-first base64 shim rejects
the old `--decode` spelling and accepts `-d` with exit zero while copying input unchanged. Four explicit assertions
prove the old failure shape: listener exit 2, byte-empty stdout, the listener's own decoder error on stderr, and an
empty protocol pending list after at-most-once dequeue. Thus the gate distinguishes a post-consumption capability
failure from fixture, command-resolution, or setup failure. Passing runs use a separately named evidence file.
