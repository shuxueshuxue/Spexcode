import Shell from './Shell.jsx'

// The workspace surface is the only host allowed to mount Explorer, the document strip, dock, and pool.
// Keeping this entrypoint separate makes the surface boundary explicit to the root router and future views.
export default function WorkspaceSurface({ route = null, inactive = false }) {
  return <Shell routeOverride={route} inactive={inactive} />
}
