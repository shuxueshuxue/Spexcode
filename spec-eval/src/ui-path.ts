const UI_FILE = /\.(jsx|tsx|vue|svelte|css)$/
export const isUiPath = (p: string) => UI_FILE.test(p) || p.includes('spec-dashboard/')
