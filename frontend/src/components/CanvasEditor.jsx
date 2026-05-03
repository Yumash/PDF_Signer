import { useRef, useEffect, useState, useCallback } from 'react'
import { Stage, Layer, Image as KonvaImage, Transformer } from 'react-konva'
import { useCanvas } from '../hooks/useCanvas'

function PageBackground({ dataUrl, width, height }) {
  const [img, setImg] = useState(null)
  useEffect(() => {
    if (!dataUrl) return
    const image = new window.Image()
    image.src = dataUrl
    image.onload = () => setImg(image)
  }, [dataUrl])
  return img ? <KonvaImage image={img} x={0} y={0} width={width} height={height} listening={false} /> : null
}

function SignatureNode({ layer, isSelected, onSelect, onChange, imageUrl }) {
  const imgRef = useRef(null)
  const trRef = useRef(null)
  const [img, setImg] = useState(null)

  useEffect(() => {
    const image = new window.Image()
    image.src = imageUrl(layer.sigId)
    image.onload = () => setImg(image)
  }, [layer.sigId, imageUrl])

  useEffect(() => {
    if (isSelected && trRef.current && imgRef.current) {
      trRef.current.nodes([imgRef.current])
      trRef.current.getLayer().batchDraw()
    }
  }, [isSelected])

  return (
    <>
      <KonvaImage
        ref={imgRef}
        image={img}
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        opacity={layer.opacity}
        draggable
        onClick={() => onSelect(layer.id)}
        onTap={() => onSelect(layer.id)}
        onDragEnd={(e) => onChange(layer.id, { x: e.target.x(), y: e.target.y() })}
        onTransformEnd={(e) => {
          const node = e.target
          onChange(layer.id, {
            x: node.x(), y: node.y(),
            width: Math.max(20, node.width() * node.scaleX()),
            height: Math.max(20, node.height() * node.scaleY()),
            rotation: node.rotation(),
          })
          node.scaleX(1)
          node.scaleY(1)
        }}
      />
      {isSelected && (
        <Transformer ref={trRef} keepRatio rotateEnabled boundBoxFunc={(old, nw) => ({
          ...nw,
          width: Math.max(20, nw.width),
          height: Math.max(20, nw.height),
        })} />
      )}
    </>
  )
}

export function CanvasEditor({ pageDataUrl, pageWidth = 794, pageHeight = 1123, imageUrl, onLayersChange }) {
  const { layers, addSignature, updateLayer, removeLayer, undo, redo, canUndo, canRedo } = useCanvas()
  const [selectedId, setSelectedId] = useState(null)
  const stageRef = useRef(null)

  useEffect(() => { onLayersChange?.(layers) }, [layers, onLayersChange])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        removeLayer(selectedId)  // graceful if null
        setSelectedId(null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, removeLayer, undo, redo])

  // Drop signature from library — load image to get natural aspect ratio, cap at 25% page width
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()  // prevent bubbling to App's file-drop handler
    const data = e.dataTransfer.getData('application/signature')
    if (!data) return
    const sig = JSON.parse(data)
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.container().getBoundingClientRect()
    const dropX = e.clientX - rect.left
    const dropY = e.clientY - rect.top

    const img = new window.Image()
    img.src = imageUrl(sig.id)
    img.onload = () => {
      if (!img.naturalWidth) { addSignature(sig, dropX, dropY); return }
      const maxW = pageWidth * 0.25
      const scale = Math.min(maxW / img.naturalWidth, 1)
      const w = Math.max(20, Math.round(img.naturalWidth * scale))
      const h = Math.max(20, Math.round(img.naturalHeight * scale))
      addSignature(sig, dropX - w / 2, dropY - h / 2, w, h)
    }
    img.onerror = () => addSignature(sig, dropX, dropY)
  }, [addSignature, imageUrl, pageWidth])

  const selectedLayer = layers.find((l) => l.id === selectedId)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Canvas area */}
      <div
        className="flex-1 overflow-auto bg-gray-200 flex items-start justify-center p-4"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <Stage
          ref={stageRef}
          width={pageWidth}
          height={pageHeight}
          style={{ background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
          onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelectedId(null) }}
        >
          <Layer>
            <PageBackground dataUrl={pageDataUrl} width={pageWidth} height={pageHeight} />
            {layers.map((layer) => (
              <SignatureNode
                key={layer.id}
                layer={layer}
                isSelected={layer.id === selectedId}
                onSelect={setSelectedId}
                onChange={updateLayer}
                imageUrl={imageUrl}
              />
            ))}
          </Layer>
        </Stage>
      </div>

      {/* Properties panel */}
      <div className="w-52 bg-white border-l flex flex-col text-xs">
        <div className="px-3 py-2 border-b font-medium text-gray-700">Свойства</div>
        <div className="flex gap-1 px-2 py-2 border-b">
          <button onClick={undo} disabled={!canUndo} className="flex-1 py-1 border rounded disabled:opacity-40 hover:bg-gray-50">↩ Undo</button>
          <button onClick={redo} disabled={!canRedo} className="flex-1 py-1 border rounded disabled:opacity-40 hover:bg-gray-50">↪ Redo</button>
        </div>

        {selectedLayer ? (
          <div className="px-3 py-2 flex flex-col gap-2">
            {[['X', 'x'], ['Y', 'y'], ['W', 'width'], ['H', 'height']].map(([label, key]) => (
              <label key={key} className="flex items-center gap-2">
                <span className="w-4 text-gray-500">{label}</span>
                <input type="number" value={Math.round(selectedLayer[key])}
                  onChange={(e) => updateLayer(selectedLayer.id, { [key]: Number(e.target.value) })}
                  className="flex-1 border rounded px-1 py-0.5 w-0" />
              </label>
            ))}
            <label className="flex items-center gap-2">
              <span className="w-8 text-gray-500">Угол</span>
              <input type="number" value={Math.round(selectedLayer.rotation)}
                onChange={(e) => updateLayer(selectedLayer.id, { rotation: Number(e.target.value) })}
                className="flex-1 border rounded px-1 py-0.5 w-0" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">Прозрачность {Math.round(selectedLayer.opacity * 100)}%</span>
              <input type="range" min={0} max={100} value={Math.round(selectedLayer.opacity * 100)}
                onChange={(e) => updateLayer(selectedLayer.id, { opacity: Number(e.target.value) / 100 })}
                className="w-full" />
            </label>
            <button onClick={() => { removeLayer(selectedLayer.id); setSelectedId(null) }}
              className="mt-2 text-red-500 border border-red-200 rounded py-1 hover:bg-red-50">
              Удалить
            </button>
          </div>
        ) : (
          <p className="text-gray-400 px-3 py-3">Выберите подпись</p>
        )}
      </div>
    </div>
  )
}
