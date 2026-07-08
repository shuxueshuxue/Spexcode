import test from 'node:test'
import assert from 'node:assert/strict'
import zh from './zh.js'

test('terminal raw-key mode is labeled as terminal interaction in Chinese', () => {
  assert.equal(zh.session.typeBtn, '终端交互')
  assert.match(zh.session.typeTitle, /^终端交互模式/)
  assert.equal(zh.session.typeInd, '⌨ 终端交互模式')
  assert.match(zh.session.typeHelp, /发送到终端/)
  assert.equal(zh.session.typeExit, '点击退出终端交互模式')
  assert.match(zh.session.cmd.typeDesc, /^终端交互模式/)
})
