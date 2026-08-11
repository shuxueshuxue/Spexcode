---
title: repo-boundary
surface: system
status: active
hue: 200
desc: A config plugin — this repository holds what every adopter needs; one deployment's hosts, paths, and rows live with that deployment, so the boundary is visible to anyone reading the committed tree.
code:
---
## What belongs in this repository

This repository is the product: the mechanism, the policy it enforces, and the tests and specs that hold both
down. What only ONE deployment knows — its hosts, its filesystem paths, its credentials, the rows naming what
it publishes — belongs with that deployment, not here.

The test is not "is it text" or "did something similar land here before". Ask: **does an adopter installing
SpexCode need this?** A server block naming `example.spexcode.net` and `/var/www/...`, a deploy script, a
watchdog, a list of the repositories we happen to publish — no adopter needs any of it, and none of it ships
in the npm package. A file no code here reads and no adopter receives is deployment configuration wearing the
product's clothes; it reads as product to the next person and quietly invites the next one beside it.

Where a deployment must reach into the product, give it a **seam** rather than a row: a flag or a path it
supplies. Editing this repository to publish one more host is the sign the boundary was drawn in the wrong
place.

This rule sits in the committed spec tree on purpose. It governs this repository's shape, so it has to be
visible to anyone reading the repository — a boundary recorded only in someone's private notes cannot defend
itself, and drifts one plausible file at a time.
