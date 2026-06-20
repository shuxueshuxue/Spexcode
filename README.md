There are a lot of principles to follow here.
(Notice a principle is not a spec.)

![Writing code vs. "authoring a living, executable specification artifact"](docs/sdd-tuxedo-pooh.png)

> Spec-driven development gets wrecked by spec drift and spec bloat. SpexCode's bet
> is to keep the spec the cheap, honest twin of the code — rewritten in place, never
> a tuxedo of stale ceremony.

- In the development process, SpexCode should be able to nicely self-upgrade and itself-develop.
- Don't reinvent the wheel. Based on tmux, claude code, git, docker...
- Unix philosophy - not a bundled environment, but a set of composable tools. Each can be used independently without others.
- AI-native. Self-explain, self-fix, self-extend for any specifc use cases.

Packages:
spec-cli
spec-dashboard
spec-yatsu
