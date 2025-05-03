'use client';

import React, { useRef, useEffect, useState } from 'react';

const TOOLS = [
  { name: 'Pencil', value: 'pencil' },
  { name: 'Eraser', value: 'eraser' },
  { name: 'Rectangle', value: 'rectangle' },
  { name: 'Circle', value: 'circle' },
  { name: 'Fill', value: 'fill' },
  { name: 'Text', value: 'text' },
];

interface Layer {
  id: number;
  name: string;
  visible: boolean;
}

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 768;

function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, fillColor: string) {
  const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const data = imageData.data;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const startIdx = (Math.floor(y) * width + Math.floor(x)) * 4;
  const targetColor = data.slice(startIdx, startIdx + 4);

  // Convert fillColor to RGBA
  const temp = document.createElement('canvas');
  temp.width = temp.height = 1;
  const tctx = temp.getContext('2d');
  if (!tctx) return;
  tctx.fillStyle = fillColor;
  tctx.fillRect(0, 0, 1, 1);
  const fill = tctx.getImageData(0, 0, 1, 1).data;

  function colorsMatch(a: Uint8ClampedArray | number[], b: Uint8ClampedArray | number[]) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  }

  if (colorsMatch(targetColor, fill)) return;

  const stack = [[Math.floor(x), Math.floor(y)]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    const idx = (cy * width + cx) * 4;
    if (colorsMatch(data.slice(idx, idx + 4), targetColor)) {
      data[idx] = fill[0];
      data[idx + 1] = fill[1];
      data[idx + 2] = fill[2];
      data[idx + 3] = fill[3];
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

const PaintEditor: React.FC = () => {
  const [tool, setTool] = useState('pencil');
  const [color, setColor] = useState('#000000');
  const [drawing, setDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [shapePreview, setShapePreview] = useState<{ x: number; y: number } | null>(null);
  const [layers, setLayers] = useState<Layer[]>([
    { id: 1, name: 'Layer 1', visible: true },
  ]);
  const [activeLayer, setActiveLayer] = useState(1);
  const layerRefs = useRef<{ [id: number]: HTMLCanvasElement | null }>({});
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const nextLayerId = useRef(2);
  const layerImagesRef = useRef<{ [id: number]: ImageData | null }>({});
  const [undoStacks, setUndoStacks] = useState<{ [id: number]: ImageData[] }>({});
  const [fontSize, setFontSize] = useState(24);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [importedImg, setImportedImg] = useState<HTMLImageElement | null>(null);
  const [imgRect, setImgRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [draggingImg, setDraggingImg] = useState(false);
  const [resizingImg, setResizingImg] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);

  // Clear all canvases on mount and when layers change
  useEffect(() => {
    layers.forEach((layer) => {
      const canvas = layerRefs.current[layer.id];
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
  }, [layers]);

  // Clear preview canvas
  useEffect(() => {
    if (previewRef.current) {
      const ctx = previewRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, [shapePreview, tool, activeLayer]);

  // Focus the input when it appears
  useEffect(() => {
    if (textPos && inputRef.current) {
      inputRef.current.focus();
    }
  }, [textPos]);

  const getPos = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // Helper to push current state to undo stack
  const pushUndo = (layerId: number) => {
    const canvas = layerRefs.current[layerId];
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setUndoStacks((prev) => {
          const stack = prev[layerId] || [];
          return { ...prev, [layerId]: [...stack, img] };
        });
      }
    }
  };

  // Undo function
  const handleUndo = () => {
    setUndoStacks((prev) => {
      const stack = prev[activeLayer] || [];
      if (stack.length === 0) return prev;
      const newStack = stack.slice(0, -1);
      const lastImg = stack[stack.length - 1];
      const canvas = layerRefs.current[activeLayer];
      if (canvas && lastImg) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.putImageData(lastImg, 0, 0);
      }
      return { ...prev, [activeLayer]: newStack };
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool === 'text' && textPos) {
      // If input is open, don't open another
      return;
    }
    const pos = getPos(e);
    if (tool === 'rectangle' || tool === 'circle') {
      pushUndo(activeLayer);
      setShapeStart(pos);
      setShapePreview(pos);
      setDrawing(true);
    } else if (tool === 'fill') {
      pushUndo(activeLayer);
      const canvas = layerRefs.current[activeLayer];
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) floodFill(ctx, pos.x, pos.y, color);
      }
    } else if (tool === 'text') {
      setTextPos(pos);
      setTextInput('');
    } else {
      pushUndo(activeLayer);
      setDrawing(true);
      setLastPos(pos);
    }
  };

  const handleMouseUp = () => {
    if (tool === 'rectangle' || tool === 'circle') {
      if (drawing && shapeStart && shapePreview) {
        const canvas = layerRefs.current[activeLayer];
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            if (tool === 'rectangle') {
              const x = Math.min(shapeStart.x, shapePreview.x);
              const y = Math.min(shapeStart.y, shapePreview.y);
              const w = Math.abs(shapePreview.x - shapeStart.x);
              const h = Math.abs(shapePreview.y - shapeStart.y);
              ctx.strokeRect(x, y, w, h);
            } else if (tool === 'circle') {
              const cx = (shapeStart.x + shapePreview.x) / 2;
              const cy = (shapeStart.y + shapePreview.y) / 2;
              const rx = Math.abs(shapePreview.x - shapeStart.x) / 2;
              const ry = Math.abs(shapePreview.y - shapeStart.y) / 2;
              ctx.beginPath();
              ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
      setDrawing(false);
      setShapeStart(null);
      setShapePreview(null);
    } else {
      setDrawing(false);
      setLastPos(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getPos(e);
    if (tool === 'rectangle' || tool === 'circle') {
      if (drawing && shapeStart) {
        setShapePreview(pos);
        // Draw preview
        if (previewRef.current) {
          const ctx = previewRef.current.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            if (tool === 'rectangle') {
              const x = Math.min(shapeStart.x, pos.x);
              const y = Math.min(shapeStart.y, pos.y);
              const w = Math.abs(pos.x - shapeStart.x);
              const h = Math.abs(pos.y - shapeStart.y);
              ctx.strokeRect(x, y, w, h);
            } else if (tool === 'circle') {
              const cx = (shapeStart.x + pos.x) / 2;
              const cy = (shapeStart.y + pos.y) / 2;
              const rx = Math.abs(pos.x - shapeStart.x) / 2;
              const ry = Math.abs(pos.y - shapeStart.y) / 2;
              ctx.beginPath();
              ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
      return;
    }
    if (!drawing) return;
    const canvas = layerRefs.current[activeLayer];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (tool === 'pencil') {
      if (lastPos) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
      setLastPos(pos);
    } else if (tool === 'eraser') {
      if (lastPos) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
      setLastPos(pos);
    }
  };

  // Draw text to canvas
  const commitText = () => {
    if (textPos && textInput.trim()) {
      pushUndo(activeLayer);
      const canvas = layerRefs.current[activeLayer];
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = color;
          ctx.textBaseline = 'top';
          ctx.fillText(textInput, textPos.x, textPos.y);
          ctx.restore();
        }
      }
    }
    setTextInput('');
    setTextPos(null);
  };

  // Save image data for all visible layers
  const saveAllVisibleLayerImages = () => {
    layers.forEach((layer) => {
      if (layer.visible && layerRefs.current[layer.id]) {
        const ctx = layerRefs.current[layer.id]?.getContext('2d');
        if (ctx) {
          layerImagesRef.current[layer.id] = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
      }
    });
  };

  // Restore image data for a layer when it becomes visible and canvas is mounted
  useEffect(() => {
    layers.forEach((layer) => {
      if (
        layer.visible &&
        layerImagesRef.current[layer.id] &&
        layerRefs.current[layer.id]
      ) {
        const ctx = layerRefs.current[layer.id]?.getContext('2d');
        if (ctx) {
          ctx.putImageData(layerImagesRef.current[layer.id]!, 0, 0);
          layerImagesRef.current[layer.id] = null;
        }
      }
    });
  }, [layers, layerRefs.current]);

  // Wrap all layer operations to save/restore images
  const addLayer = () => {
    saveAllVisibleLayerImages();
    const id = nextLayerId.current++;
    setLayers((prev) => [...prev, { id, name: `Layer ${id}`, visible: true }]);
    setActiveLayer(id);
  };

  const deleteLayer = (id: number) => {
    saveAllVisibleLayerImages();
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (activeLayer === id && layers.length > 1) {
      const idx = layers.findIndex((l) => l.id === id);
      const newActive = layers[idx === 0 ? 1 : idx - 1].id;
      setActiveLayer(newActive);
    }
  };

  const moveLayer = (id: number, dir: 'up' | 'down') => {
    saveAllVisibleLayerImages();
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      let newArr = [...prev];
      if (dir === 'up' && idx > 0) {
        [newArr[idx - 1], newArr[idx]] = [newArr[idx], newArr[idx - 1]];
      } else if (dir === 'down' && idx < prev.length - 1) {
        [newArr[idx + 1], newArr[idx]] = [newArr[idx], newArr[idx + 1]];
      }
      return newArr;
    });
  };

  const toggleLayerVisibility = (id: number) => {
    saveAllVisibleLayerImages();
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  };

  // Export merged image as PNG
  const exportAsPNG = () => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return;
    layers.forEach((layer) => {
      if (layer.visible) {
        const src = layerRefs.current[layer.id];
        if (src) {
          exportCtx.drawImage(src, 0, 0);
        }
      }
    });
    exportCanvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'paint.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  };

  // Overlay click handler for text tool
  const handleTextOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'text' || textPos) return;
    const rect = (e.target as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTextPos({ x, y });
    setTextInput('');
  };

  // Handle image import
  const handleImportImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new window.Image();
    img.onload = () => {
      setImportedImg(img);
      setImgRect({ x: 100, y: 100, w: img.width > 300 ? 300 : img.width, h: img.height > 300 ? 300 : img.height });
    };
    img.src = url;
  };

  // Improved drag/resize logic with global mouse events
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!imgRect) return;
      const areaRect = canvasAreaRef.current?.getBoundingClientRect();
      if (!areaRect) return;
      const x = e.clientX - areaRect.left;
      const y = e.clientY - areaRect.top;
      if (draggingImg && dragOffset) {
        setImgRect((prev) => prev ? { ...prev, x: x - dragOffset.x, y: y - dragOffset.y } : prev);
      } else if (resizingImg && resizeStart) {
        setImgRect((prev) => prev ? {
          ...prev,
          w: Math.max(16, resizeStart.w + (x - resizeStart.x)),
          h: Math.max(16, resizeStart.h + (y - resizeStart.y)),
        } : prev);
      }
    }
    function onMouseUp() {
      setDraggingImg(false);
      setResizingImg(false);
      setDragOffset(null);
      setResizeStart(null);
    }
    if (draggingImg || resizingImg) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }
  }, [draggingImg, resizingImg, dragOffset, resizeStart, imgRect]);

  // Mouse down for drag or resize
  const handleImgMouseDown = (e: React.MouseEvent) => {
    if (!imgRect) return;
    const areaRect = canvasAreaRef.current?.getBoundingClientRect();
    if (!areaRect) return;
    const x = e.clientX - areaRect.left;
    const y = e.clientY - areaRect.top;
    // Only allow drag if not on resize handle
    if (
      x > imgRect.x + imgRect.w - 16 && x < imgRect.x + imgRect.w &&
      y > imgRect.y + imgRect.h - 16 && y < imgRect.y + imgRect.h
    ) {
      setResizingImg(true);
      setResizeStart({ x, y, w: imgRect.w, h: imgRect.h });
    } else if (
      x > imgRect.x && x < imgRect.x + imgRect.w &&
      y > imgRect.y && y < imgRect.y + imgRect.h
    ) {
      setDraggingImg(true);
      setDragOffset({ x: x - imgRect.x, y: y - imgRect.y });
    }
    e.stopPropagation();
    e.preventDefault();
  };

  // Place image on canvas
  const handlePlaceImage = () => {
    if (!importedImg || !imgRect) return;
    pushUndo(activeLayer);
    const canvas = layerRefs.current[activeLayer];
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(importedImg, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
      }
    }
    setImportedImg(null);
    setImgRect(null);
    setDraggingImg(false);
    setResizingImg(false);
    setDragOffset(null);
    if (imgUrl) {
      URL.revokeObjectURL(imgUrl);
      setImgUrl(null);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Toolbar */}
      <div style={{ width: 80, background: '#fff', borderRight: '1px solid #ccc', padding: 8 }}>
        <div style={{ marginBottom: 16 }}>Tools</div>
        <button
          style={{
            display: 'block',
            marginBottom: 8,
            background: '#fff',
            border: '1px solid #ccc',
            width: '100%',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
          onClick={handleUndo}
          disabled={!(undoStacks[activeLayer] && undoStacks[activeLayer].length > 0)}
        >
          Undo
        </button>
        {TOOLS.map((t) => (
          <button
            key={t.value}
            style={{
              display: 'block',
              marginBottom: 8,
              background: tool === t.value ? '#e0e0e0' : '#fff',
              border: '1px solid #ccc',
              width: '100%',
              cursor: 'pointer',
            }}
            onClick={() => setTool(t.value)}
          >
            {t.name}
          </button>
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ width: '100%', marginTop: 16 }}
        />
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 12 }}>Font size</label>
          <input
            type="number"
            min={8}
            max={128}
            value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <label style={{ display: 'block', marginTop: 16, fontSize: 12 }}>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImportImage}
          />
          <span style={{ cursor: 'pointer', border: '1px solid #ccc', padding: 4, display: 'block', textAlign: 'center', background: '#f8f8f8' }}>
            Import Image
          </span>
        </label>
      </div>
      {/* Main drawing area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Export button */}
        <div style={{ padding: 8, background: '#f8f8f8', borderBottom: '1px solid #eee' }}>
          <button onClick={exportAsPNG}>Export as PNG</button>
        </div>
        {/* Canvas stack */}
        <div
          ref={canvasAreaRef}
          style={{ flex: 1, position: 'relative', background: '#fff' }}
        >
          {layers.map((layer, idx) =>
            layer.visible ? (
              <canvas
                key={layer.id}
                ref={(el) => {
                  layerRefs.current[layer.id] = el;
                }}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                style={{
                  border: idx === 0 ? '1px solid #ccc' : 'none',
                  margin: 16,
                  background: 'transparent',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  zIndex: idx,
                  pointerEvents: importedImg ? 'none' : layer.id === activeLayer ? 'auto' : 'none',
                }}
                onMouseDown={layer.id === activeLayer && !importedImg ? handleMouseDown : undefined}
                onMouseUp={layer.id === activeLayer && !importedImg ? handleMouseUp : undefined}
                onMouseLeave={layer.id === activeLayer && !importedImg ? handleMouseUp : undefined}
                onMouseMove={layer.id === activeLayer && !importedImg ? handleMouseMove : undefined}
              />
            ) : null
          )}
          {/* Preview canvas for shapes */}
          <canvas
            ref={previewRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              zIndex: 1000,
              pointerEvents: 'none',
            }}
          />
          {/* Image overlay for dragging/resizing */}
          {importedImg && imgRect && (
            <div
              style={{
                position: 'absolute',
                left: imgRect.x,
                top: imgRect.y,
                width: imgRect.w,
                height: imgRect.h,
                zIndex: 4000,
                border: '2px dashed #888',
                cursor: resizingImg ? 'nwse-resize' : draggingImg ? 'move' : 'pointer',
                background: 'rgba(255,255,255,0.2)',
                userSelect: 'none',
              }}
              onMouseDown={handleImgMouseDown}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgUrl || importedImg.src}
                style={{ width: '100%', height: '100%', pointerEvents: 'none', display: 'block' }}
                draggable={false}
                alt="imported"
              />
              {/* Resize handle */}
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 16,
                  height: 16,
                  background: '#fff',
                  border: '1px solid #888',
                  cursor: 'nwse-resize',
                  zIndex: 4100,
                }}
              />
              {/* Place button */}
              <button
                onClick={handlePlaceImage}
                style={{
                  position: 'absolute',
                  top: -32,
                  left: 0,
                  zIndex: 4200,
                  background: '#4caf50',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                Place
              </button>
            </div>
          )}
          {/* Overlay for text tool click */}
          {tool === 'text' && !textPos && (
            <div
              onClick={handleTextOverlayClick}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                zIndex: 2000,
                cursor: 'text',
                background: 'transparent',
              }}
            />
          )}
          {/* Text input overlay */}
          {tool === 'text' && textPos && (
            <input
              ref={inputRef}
              autoFocus
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onBlur={commitText}
              onKeyDown={e => {
                if (e.key === 'Enter') commitText();
              }}
              style={{
                position: 'absolute',
                left: textPos.x,
                top: textPos.y,
                fontSize: fontSize,
                color: color,
                border: '1px solid #888',
                background: 'rgba(255,255,255,0.8)',
                zIndex: 3000,
                padding: 2,
                minWidth: 40,
              }}
            />
          )}
        </div>
      </div>
      {/* Layers panel */}
      <div style={{ width: 200, background: '#fafafa', borderLeft: '1px solid #ccc', padding: 8 }}>
        <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Layers</div>
        <button onClick={addLayer} style={{ width: '100%', marginBottom: 8 }}>+ Add Layer</button>
        <div>
          {layers.map((layer, idx) => (
            <div
              key={layer.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                background: activeLayer === layer.id ? '#e0e0e0' : 'transparent',
                marginBottom: 4,
                padding: 4,
                borderRadius: 4,
                cursor: 'pointer',
              }}
              onClick={() => setActiveLayer(layer.id)}
            >
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() => toggleLayerVisibility(layer.id)}
                style={{ marginRight: 4 }}
                title="Toggle visibility"
              />
              <span style={{ flex: 1 }}>{layer.name}</span>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }} disabled={idx === 0} title="Move up">↑</button>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }} disabled={idx === layers.length - 1} title="Move down">↓</button>
              <button onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }} disabled={layers.length === 1} title="Delete">🗑️</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PaintEditor; 