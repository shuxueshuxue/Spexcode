# App market promotional artwork

Each HTML file is a reusable 1600 × 900 (16:9) canvas: App icon and name, one concise benefit, and an existing real screenshot. The dark brand canvas stays fixed in both client themes. Text uses Noto Sans CJK SC with PingFang SC as the macOS fallback.

Open a template in a headless Chromium browser with a 1600 × 900 viewport. Wait for `document.fonts.ready`, decode every image, and wait two animation frames; capture only `.promo` at device scale 1. Save to the App package’s `screenshots/promo.png`; verify 1600 × 900 and at most 1 MiB. Keep the same browser and fonts for a batch. The current exports use Chromium 155.

To add an App, copy a template and replace the icon, name, benefit, screenshot path and brand color variables. Keep the product screenshot real. Do not redraw controls, invent features or stretch the screenshot. Prepend a Markdown image to the package README and preserve every original image afterward. A new package version and normal index PR are required.

## Screenshot sources

All product images below already existed in the corresponding App before this artwork change. Only their placement inside the promotional frame is new.

| Template | Product screenshot, relative to package root | SHA-256 |
| --- | --- | --- |
| `spexcode.html` | `screenshots/1.jpg` | `015bbc5f75223bb6c7295907918e20f860f3fc00d9b634a14b020fbcbc52ad85` |
