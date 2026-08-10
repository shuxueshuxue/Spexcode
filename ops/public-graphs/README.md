# Public graph releases

`public-graphs/registry.json` is the source of truth for public repository hosts. A row is added only after
the repository owner, hostname, and About copy have been reviewed together. A checkout name, branch name, or
first deployment must never create a hostname implicitly.

For a registered row, `npm run build:public -- --publication <id>` emits a sealed static release under
`spec-dashboard/dist-public/`. The release manifest hashes the graph index, node documents, About metadata,
and the `.spec` archive. Deployment stages that exact directory under the row's isolated release root and
switches its `site` symlink atomically. It does not touch `/var/www/spexcode-docs/site` or the docs publication
marker.

The current row is `spexcode`: `shuxueshuxue/spexcode` -> `spexcode.spexcode.net`. The old
`herdr.spexcode.net` trial alias is a migration redirect only. A future repository gets a new registry row,
release root, and nginx server block in the same reviewed change; it is never served by reusing another row.
