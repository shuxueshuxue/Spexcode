import test from 'node:test'
import assert from 'node:assert/strict'
import en from './en.js'
import zh from './zh.js'

test('eval detail copy names filed measurements as results in both locales', () => {
  assert.equal(en.detail.sideReading, 'result')
  assert.equal(en.annotator.abMore({ n: 3 }), 'older results (3)')
  assert.match(en.annotator.cmd.okDesc, /^sign off this result .* latest result only/)
  assert.equal(zh.detail.sideReading, '结果')
  assert.equal(zh.annotator.abMore({ n: 3 }), '更早的结果（3）')
  assert.match(zh.annotator.cmd.okDesc, /^签核这条结果 .*当前最新结果/)
})

test('the authored control surface is consistently named Command Box in Chinese', () => {
  assert.equal(zh.session.commandBtn, 'Command Box')
  assert.equal(zh.session.commandBox, 'Command Box')
  assert.match(zh.session.commandTitle, /完整指令.*Alt\/Cmd\+I/)
  assert.match(zh.session.commandPlaceholder, /完整指令/)
  assert.match(zh.session.commandSend, /Command Box/)
})

test('locked session hint describes changed-node browsing without extra modifier labels in Chinese', () => {
  assert.equal(zh.lockHint.singleChanged, '此会话更改了 1 个节点')
  assert.equal(zh.lockHint.cycleNext, ' 下一个')
  assert.equal(zh.lockHint.cyclePrev, ' 上一个')
  assert.equal(zh.lockHint.cycleAfter({ n: 2 }), '，浏览此会话更改的 2 个节点')
})
