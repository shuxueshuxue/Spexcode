# Eval closure batch four

Session: `51f57a00`
Measured commit: `14f2d7760f40fd4f64ae340724859d423b66680f`
Ancestry: `git merge-base --is-ancestor 14f2d7760 HEAD` exited `0`.
Toolchain: absolute Node `22.21.0`, npm `10.9.4`; `npm ci --ignore-scripts` and the repository build passed.
Fixtures used isolated `SPEXCODE_HOME`, ports, and temporary directories. No setup/dependency failures were observed.

| Scenario | Verdict | Evidence SHA-256 |
| --- | --- | --- |
| `password-gated-remote-client` | PASS | `cddc271dc7fde0ae7a6550a70a7939493ab70303820257506c0ba7601ffc5811` |
| `cache-read-local-fallback` | PASS | `e606f1ba5b46da7c0c38aef965646a3a6186f352249480efbfeaafa030c33ff5` |
| `wrong-project-write-refused` | PASS | `f8f273a3fcaa85c8b3c27706823579d2e4fa3c3ed3c6ff89876bebd629e2017f` |
| `peer-project-operations-stay-remote` | PASS | `1ef8624e472a7578723b2c122f892f614260908a5e75d0d8539936aae17d2878` |

Only eval sidecars and this ledger changed. No product code, declarations, acceptance, or bulk acknowledgement was changed.
