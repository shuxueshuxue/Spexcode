---
scenarios:
  - name: installed-cli-fails-closed-before-opening-storage
    tags: [cli]
    description: >
      Install the packed adopter and protocol into a clean external consumer, verify the package resolves under
      node_modules, and invoke the binary with a real local parent plus injected vector coverage for all classifier
      and detector refusal outcomes.
    expected: >
      The real local parent opens, known local magic is admitted, and network, unknown, unsupported-platform, and
      failed-probe cases are refused with their exact LOCALITY_* codes. Only the explicit argv flag bypasses the
      probe; environment and config data cannot do so. The result labels real network mounts and non-Linux detectors
      as unmeasured evidence gaps rather than passes.
    code: packages/session-selflaunch/src/locality.ts
---
# self-launch storage locality loss

The installed run proves the Linux detector on this host and the classifier's supplied-magic decisions. It must
report the network-mount and non-Linux detector population as unmeasured, because a synthetic magic value is not a
mounted filesystem.
