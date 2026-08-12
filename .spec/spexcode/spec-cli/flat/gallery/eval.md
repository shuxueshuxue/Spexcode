---
scenarios:
  - name: gallery-journey
    description: >
      Serve an assembled gallery from a plain static file server whose only behaviour beyond returning files
      is the directory-to-slashed-form redirect nginx performs, then take a stranger's path in a real browser:
      arrive at the root, read the list, click an entry, wait for its graph, open a node's prose, and finally
      request the same entry WITHOUT its trailing slash. Verify every release hash in gallery.json against the
      bytes being served before any of it.
    expected: >
      Each manifest hash matches, the index lists exactly the flats the manifest names, its banner asset loads,
      the agent selector changes the displayed conversion command, the clicked entry renders its graph under
      its own path prefix and opens a document, the slashless URL lands on the same page, and the browser
      console stays empty — including no 404 for a favicon nobody shipped.
    tags: [frontend-e2e, cli]
  - name: publish-leaves-a-receipt
    description: >
      Publish a gallery to the live host and then read the host back: the release directory, the receipt
      beside it, the serving symlink, and an HTTP request through the real vhost. Also check the two
      publications that share this machine before and after.
    expected: >
      A new release directory exists carrying a receipt that names who published it, when, from which
      toolchain commit, and the hash of every artifact; the serving symlink points at it; the vhost answers
      200 for the gallery and for an entry; and the docs and public-graph publications on the same host answer
      exactly as they did before. A release nobody can attribute is the failure this scenario exists to catch.
    tags: [cli, frontend-e2e]
---

# measuring the gallery

Both scenarios run against files served the way the host serves them — no dev server, no rewrites, no
fallbacks the production vhost does not have. A gallery is only interesting because it is static, so a
measurement that needed an application to be running would be measuring something else.

`gallery-journey` asserts an empty console rather than merely a rendered page. A published page that works
while logging failures is how a missing favicon or a stale chunk hides until someone else finds it.

`publish-leaves-a-receipt` deliberately reads the HOST rather than the publishing script's own output. The
defect it exists to catch is a release nobody can attribute — which a script reporting its own success
cannot reveal, because that is exactly what the unattributable publication on this same host also did.
