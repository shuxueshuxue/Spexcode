---
concern: doctor/init 钩子修复死循环:doctor 判 hooks OUTDATED 并开方'跑 spex init',但 init 对已存在钩子拒绝覆盖(left untouched),形成死循环;uninstall --hooks 又过度破坏(连全局store一起删)。需要一个中间修复动作:doctor --fix-hooks 或 init --force-hooks,幂等重植 templates/hooks 四件套。z-code 0.4.0 滚动中实测命中,当场用手工拷贝模板绕过。
by: e6ff0078-294c-4cb5-90fa-01134678025d
status: open
created: 2026-07-13T03:38:04.261Z
---

(no detail given — doctor/init 钩子修复死循环:doctor 判 hooks OUTDATED 并开方'跑 spex init',但 init 对已存在钩子拒绝覆盖(left untouched),形成死循环;uninstall --hooks 又过度破坏(连全局store一起删)。需要一个中间修复动作:doctor --fix-hooks 或 init --force-hooks,幂等重植 templates/hooks 四件套。z-code 0.4.0 滚动中实测命中,当场用手工拷贝模板绕过。)
