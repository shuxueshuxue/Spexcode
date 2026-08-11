---
title: repo-boundary
surface: system
status: active
hue: 200
desc: A config plugin — a repository holds what everyone who uses it needs; what only one environment knows belongs with that environment, and the rule sits here so it stays visible to whoever reads the tree.
code:
---
## What belongs in this repository

This repository holds the thing itself: the mechanism, the policy it enforces, and the tests and specs that
hold both down. What only ONE environment knows — its hosts, its filesystem paths, its credentials, the rows
naming what it happens to run — belongs with that environment, not here.

The test is not "is it text" or "did something similar land here before". Ask: **does everyone who uses this
repository need it?** A server block naming one host and its `/var/...` paths, a deploy script, a watchdog, a
list of the instances we happen to operate — nobody consuming this repository needs any of it. A file no code
here reads and no consumer receives is environment configuration wearing the project's clothes: it reads as
part of the thing to the next person, and quietly invites the next one beside it.

Where an environment must reach into the repository, give it a **seam** rather than a row — a flag, a path,
a config file it supplies. Having to edit this repository to stand up one more instance is the sign the
boundary was drawn in the wrong place.

This rule lives in the tree it governs on purpose. A boundary recorded only in someone's private notes cannot
defend itself, and drifts one plausible file at a time.
