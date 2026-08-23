// Adapter for the second candidate binding. Present so the identical conformance vectors can be
// driven through better-sqlite3, proving the frozen contract is driver-independent.
// Install it first (it is deliberately not a dependency of the spike):
//   npm install --no-save better-sqlite3
import Database from 'better-sqlite3'

export const betterSqlite3Driver = {
  name: 'better-sqlite3',
  open: (path, { readOnly }) => {
    const db = new Database(path, { readonly: readOnly, fileMustExist: false })
    return {
      exec: sql => db.exec(sql),
      prepare: sql => {
        const statement = db.prepare(sql)
        return {
          // better-sqlite3 refuses get()/all() on a statement that returns no rows, so route those
          // through run(). node:sqlite makes no such distinction.
          get: (...params) => (statement.reader ? statement.get(...params) : (statement.run(...params), undefined)),
          all: (...params) => (statement.reader ? statement.all(...params) : (statement.run(...params), [])),
          run: (...params) => statement.run(...params),
        }
      },
      close: () => db.close(),
    }
  },
}
export default betterSqlite3Driver
