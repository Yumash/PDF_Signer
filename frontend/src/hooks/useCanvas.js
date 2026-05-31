import { useCallback } from 'react'
import { useHistory } from './useHistory'

export function useCanvas(initialLayers = []) {
  const { state: layers, push, undo, redo, canUndo, canRedo } = useHistory(initialLayers)

  const addSignature = useCallback((sig, x = 100, y = 100, width = 200, height = 80) => {
    push([...layers, {
      id: `${sig.id}-${Date.now()}`,
      sigId: sig.id,
      x, y,
      width: Math.max(20, width),
      height: Math.max(20, height),
      rotation: 0,
      opacity: 1,
    }])
  }, [layers, push])

  const updateLayer = useCallback((id, props) => {
    push(layers.map((l) => l.id === id ? { ...l, ...props } : l))
  }, [layers, push])

  const removeLayer = useCallback((id) => {
    if (!id) return  // graceful: no selection
    push(layers.filter((l) => l.id !== id))
  }, [layers, push])

  return { layers, addSignature, updateLayer, removeLayer, undo, redo, canUndo, canRedo }
}
