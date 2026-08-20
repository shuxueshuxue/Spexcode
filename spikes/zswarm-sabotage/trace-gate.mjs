import { readFileSync } from 'node:fs'

const FILE_SYSCALL = /^(?:\d+\s+|\[pid\s+\d+\]\s+)?(?:access|chdir|chmod|chown|faccessat2?|fchmodat2?|fchownat|lchown|link|linkat|lstat|mkdir|mkdirat|mknod|mknodat|mount|name_to_handle_at|newfstatat|open|openat|openat2|open_by_handle_at|pivot_root|quotactl|readlink|readlinkat|rename|renameat|renameat2|rmdir|stat|statx|symlink|symlinkat|truncate|umount2|unlink|unlinkat|utime|utimensat|utimes)\(/

export function fileSyscallLines(tracePath) {
  return readFileSync(tracePath, 'utf8')
    .split('\n')
    .filter(line => FILE_SYSCALL.test(line))
}

export function countFileSyscallHits(tracePath, selectors) {
  const lines = fileSyscallLines(tracePath)
  return {
    fileSyscallLines: lines.length,
    hits: lines.filter(line => selectors.some(selector => line.includes(selector))),
  }
}
