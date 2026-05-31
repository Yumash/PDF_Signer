import { useCallback } from 'react'
import { useHistory } from './useHistory'
import { MIN_LAYER_SIZE } from '../constants'

export function useCanvas(initialLayers = []) {
  const { state: layers, push, set, undo, redo, canUndo, canRedo } = useHistory(initialLayers)

  const addSignature = useCallback((sig, x = 100, y = 100, width = 200, height = 80) => {
    push([...layers, {
      id: `${sig.id}-${Date.now()}`,
      sigId: sig.id,
      x, y,
      width: Math.max(MIN_LAYER_SIZE, width),
      height: Math.max(MIN_LAYER_SIZE, height),
      rotation: 0,
      opacity: 1,
    }])
  }, [layers, push])

  const updateLayer = useCallback((id, props) => {
    push(layers.map((l) => l.id === id ? { ...l, ...props } : l))
  }, [layers, push])

  // Live (no-history) layer patch — for continuous edits (number fields, slider).
  const updateLayerLive = useCallback((id, props) => {
    set(layers.map((l) => l.id === id ? { ...l, ...props } : l))
  }, [layers, set])

  // Record a single undo point at the current state (call at edit-session start).
  const checkpoint = useCallback(() => push(layers), [layers, push])

  const removeLayer = useCallback((id) => {
    if (!id) return  // graceful: no selection
    push(layers.filter((l) => l.id !== id))
  }, [layers, push])

  return { layers, addSignature, updateLayer, updateLayerLive, checkpoint, removeLayer, undo, redo, canUndo, canRedo }
}
