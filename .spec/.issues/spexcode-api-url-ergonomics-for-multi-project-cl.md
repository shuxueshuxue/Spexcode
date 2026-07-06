---
concern: SPEXCODE_API_URL ergonomics for multi-project CLI use: driving a second project's backend requires prefixing EVERY command with SPEXCODE_API_URL=http://127.0.0.1:<port> because the var inherited from the primary backend wins — lived this for a whole play session on /home/jeffry/tmc (:8901) while my env carried the spexcode :8787 URL. The layout seam could resolve the backend from the CWD project itself (e.g. spexcode.local.json records the project's serve port at spex serve time; client.ts prefers the cwd project's recorded endpoint over the inherited env, env still winning when explicitly set on the command). Today's workaround is documented but noisy and error-prone — one forgotten prefix sends a write to the wrong project's backend.
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: remote-client
created: 2026-07-06T09:52:37.909Z
---

(no detail given — SPEXCODE_API_URL ergonomics for multi-project CLI use: driving a second project's backend requires prefixing EVERY command with SPEXCODE_API_URL=http://127.0.0.1:<port> because the var inherited from the primary backend wins — lived this for a whole play session on /home/jeffry/tmc (:8901) while my env carried the spexcode :8787 URL. The layout seam could resolve the backend from the CWD project itself (e.g. spexcode.local.json records the project's serve port at spex serve time; client.ts prefers the cwd project's recorded endpoint over the inherited env, env still winning when explicitly set on the command). Today's workaround is documented but noisy and error-prone — one forgotten prefix sends a write to the wrong project's backend.)
