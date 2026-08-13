---
title: gallery
status: active
hue: 165
desc: Many flats on one static host at flatcode.spexcode.net/<owner>/<repo> — assembled by a command, published with a receipt, and serving nothing a static file server cannot.
related:
  - spec-cli/src/flat.ts
  - spec-cli/src/flat.test.ts
---
# gallery

A single flat is a directory anyone can serve. The gallery is the question of what happens when there are
twenty of them and a stranger wants to read one: they need a place to arrive, a way to tell the flats apart,
and a reason to believe what they are reading came from the repository it claims.

`spex flat gallery --out <dir> <flat-dir>…` answers the first two. Each flat's site is copied to
`<out>/<slug>/`, an index page lists them with source, coverage, node count and revision, and `gallery.json`
records the same list plus a SHA-256 of every flat's own release manifest. The command composes existing
artifacts and invents no format: a flat in the gallery is byte-identical to the flat on the machine that
produced it.

The index is also the self-serve entry point. It shows the one-time `npm i -g spexcode` install, asks the
visitor to choose the local agent that will run the conversion, and updates the displayed `spex flat new`
command with that explicit launcher. It states that a repository URL is cloned and initialized before conversion,
while a local repository is continued in place and receives only `.spec` work; it never tells a visitor to
perform those internal steps by hand. A packaged bitmap banner depicts the repository-to-graph
transformation and is copied beside `index.html`, so an assembled gallery has no asset dependency on the
machine that built it. The agent choice keeps native keyboard and screen-reader behavior while using the
gallery's dark control styling, and the banner is encoded as a same-dimension, high-quality WebP so the hero
does not make the first visit wait on an unnecessarily large download.

## The slug belongs to the source, and cannot leave the root

A flat is served at the slug of the repository it READ, never at the name of the directory Flatcode wrote
into — two people flattening the same repository must land on the same path, and `--out` is an accident of
one machine. That makes the slug a function of an attacker-controllable string which then becomes a directory
on a public host, so it is sanitized **per path segment**: a traversal segment cannot survive as one, and the
result is always a relative path of non-empty segments. Sanitizing the string as a whole is the shape of this
that looks right and is not — it rewrites the dots in `../../etc/passwd` and leaves an absolute path behind.

## Serving is static, and the trailing slash is load-bearing

The host is an ordinary static file server: no application, no database, no write route, nothing that can be
asked to do anything but return a file. Each flat carries its own hashed bundle under its own directory, so
the immutable-cache rule matches `/<owner>/<repo>/assets/`, not `/assets/` — a single-publication host's
pattern silently caches nothing here. The vhost that encodes those rules is **not in this repository**: a
server block naming one host's paths is deployment configuration, and it lives with the deployment scripts
that install it, not beside the code that produced the files.

A directory URL must redirect to its slashed form before anything renders. The published artifact resolves
its payload relative to its own URL ([[flat]]), so at `/psf/requests` the browser would ask for
`/psf/specs/…` and get a 404 that looks like a broken flat rather than a missing slash.

## Publishing leaves a receipt

The existing single-repository publication on this host reached it by hand and left nothing behind — no
scheduler, no workflow, no record of who published what, only root-owned bytes. That is the one thing this
surface must not copy. A gallery release is staged into its own directory and the serving symlink is switched
atomically, and the release carries the gallery manifest that names every entry and hashes each flat's
release, so what is being served can always be compared with what was built. A publication nobody can audit
is indistinguishable from one nobody performed.

Producing a flat costs an agent run against real credentials, which no unattended CI here holds. So the
gallery deliberately publishes **pre-produced** artifacts rather than converting on the host: the expensive,
credentialed step stays where the credentials are, and the host only ever receives files.
