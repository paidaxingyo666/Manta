import { createRoot, type Root } from 'react-dom/client'

type RendererRootHotData = {
  mantaRendererRoot?: Root
}

export function getOrCreateRendererRoot(
  container: HTMLElement,
  hotData?: RendererRootHotData
): Root {
  const existingRoot = hotData?.mantaRendererRoot
  if (existingRoot) {
    return existingRoot
  }
  const root = createRoot(container)
  if (hotData) {
    hotData.mantaRendererRoot = root
  }
  return root
}
