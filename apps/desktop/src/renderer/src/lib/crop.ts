/**
 * Geometry of the crop editor. The image is turned a quarter at a time, scaled so it always
 * covers the frame (zoom 1 = just covering), and moved by its center. The API gets the frame as a
 * rectangle in the turned original's pixels (ImageCrop) and does the actual crop.
 */

import type { ImageCrop } from './api'

export type Rotation = 0 | 90 | 180 | 270

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export interface Size {
  width: number
  height: number
}

/** Where the editor is: the turn, the zoom and the point of the turned image at the frame's center. */
export interface CropView {
  rotate: Rotation
  zoom: number
  cx: number
  cy: number
}

/** The image's size once turned. */
export function turned(image: Size, rotate: Rotation): Size {
  return rotate === 90 || rotate === 270 ? { width: image.height, height: image.width } : image
}

/** Screen pixels per image pixel. */
export function scaleOf(view: CropView, image: Size, frame: Size): number {
  const t = turned(image, view.rotate)
  return Math.max(frame.width / t.width, frame.height / t.height) * view.zoom
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** Keeps the zoom in range and the frame inside the image. */
export function clampView(view: CropView, image: Size, frame: Size): CropView {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM)
  const t = turned(image, view.rotate)
  const s = scaleOf({ ...view, zoom }, image, frame)
  const hw = frame.width / s / 2
  const hh = frame.height / s / 2
  return { rotate: view.rotate, zoom, cx: clamp(view.cx, hw, t.width - hw), cy: clamp(view.cy, hh, t.height - hh) }
}

/** Starts centered, at zoom 1. */
export function initialView(image: Size): CropView {
  return { rotate: 0, zoom: 1, cx: image.width / 2, cy: image.height / 2 }
}

/** Dragging by (dx, dy) screen pixels moves the image with the pointer. */
export function panView(view: CropView, image: Size, frame: Size, dx: number, dy: number): CropView {
  const s = scaleOf(view, image, frame)
  return clampView({ ...view, cx: view.cx - dx / s, cy: view.cy - dy / s }, image, frame)
}

/** Zooms keeping the frame's center in place. */
export function zoomView(view: CropView, image: Size, frame: Size, zoom: number): CropView {
  return clampView({ ...view, zoom }, image, frame)
}

/** A quarter turn clockwise around the frame's center. */
export function rotateView(view: CropView, image: Size, frame: Size): CropView {
  const t = turned(image, view.rotate)
  const rotate = ((view.rotate + 90) % 360) as Rotation
  return clampView({ rotate, zoom: view.zoom, cx: t.height - view.cy, cy: view.cx }, image, frame)
}

/** The frame as the API's rectangle (whole pixels, inside the image). */
export function cropOf(view: CropView, image: Size, frame: Size): ImageCrop {
  const t = turned(image, view.rotate)
  const s = scaleOf(view, image, frame)
  const width = Math.min(t.width, Math.max(1, Math.round(frame.width / s)))
  const height = Math.min(t.height, Math.max(1, Math.round(frame.height / s)))
  const x = clamp(Math.round(view.cx - frame.width / s / 2), 0, t.width - width)
  const y = clamp(Math.round(view.cy - frame.height / s / 2), 0, t.height - height)
  return { x, y, width, height, rotate: view.rotate }
}

/** Back from a saved rectangle ("Ajustar posição"). */
export function viewOf(crop: ImageCrop, image: Size, frame: Size): CropView {
  const rotate = crop.rotate as Rotation
  const base = scaleOf({ rotate, zoom: 1, cx: 0, cy: 0 }, image, frame)
  const zoom = frame.width / crop.width / base
  return clampView({ rotate, zoom, cx: crop.x + crop.width / 2, cy: crop.y + crop.height / 2 }, image, frame)
}

/**
 * How to draw the view: a box the size of the turned image at `left`/`top` of the frame, and the
 * untouched image centered in it, turned. Scales with the frame, so previews reuse it.
 */
export function layoutOf(view: CropView, image: Size, frame: Size): { left: number; top: number; box: Size; img: Size } {
  const s = scaleOf(view, image, frame)
  const t = turned(image, view.rotate)
  return {
    left: frame.width / 2 - view.cx * s,
    top: frame.height / 2 - view.cy * s,
    box: { width: t.width * s, height: t.height * s },
    img: { width: image.width * s, height: image.height * s }
  }
}
