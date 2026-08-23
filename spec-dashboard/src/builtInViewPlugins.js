export function createSettingsViewPlugin(component) {
  return {
    id: 'dashboard-settings',
    views: {
      settings: {
        component,
        surface: 'workspace',
        document: true,
        resident: true,
        icon: 'settings',
        className: 'view-settings',
      },
    },
  }
}
