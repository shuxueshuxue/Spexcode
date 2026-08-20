# Fail-first note

Command, run with Node 22.21.0 before the resolver implementation:

```sh
PATH=$HOME/.nvm/versions/node/v22.21.0/bin:$PATH ../../node_modules/.bin/tsx --test src/path.test.ts
```

The retained output is `fail-first.log`. It exited 1 after loading both the test and the intentionally incomplete
resolver. The failure is discriminating: Node's own `assert.throws` raised `ERR_ASSERTION` with the message that
`resolveDatabasePath` accepted `relative.sqlite` instead of producing `PROTOCOL_PATH_NOT_ABSOLUTE`. A missing module,
bad command, or fixture path did not produce this failure.

This log is immutable evidence and is never the target of a test command. Later pass runs use ordinary terminal
output and the separately named installed YATU evidence.
