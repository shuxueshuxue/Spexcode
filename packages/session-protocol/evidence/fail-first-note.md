# Fail-first note

The package built and loaded before this reading. The deliberately incomplete `openProtocol` accepted a relative
database path, so the vector's own `assert.throws` raised `ERR_ASSERTION` with the exact missing protocol code in its
message. A correct path gate would make this assertion pass, which makes the failure discriminate between the
minimal implementation and the frozen path contract.

This reading proves only that the production vector detects the absent relative-path gate. It does not prove any
connection setting, schema, canonical bytes, message operation, migration, contention, crash, or package-boundary
behaviour. Those claims require their own passing vectors after the implementation exists.
