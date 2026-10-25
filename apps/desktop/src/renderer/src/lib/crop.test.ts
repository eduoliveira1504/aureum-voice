import { describe, expect, it } from 'vitest'

import { clampView, cropOf, initialView, layoutOf, panView, rotateView, viewOf, zoomView, type CropView } from './crop'

const image = { width: 400, height: 200 }
const square = { width: 100, height: 100 }
const start = (): CropView => clampView(initialView(image), image, square)

describe('crop geometry', () => {
  it('starts centered, covering the frame with the short side', () => {
    expect(cropOf(start(), image, square)).toEqual({ x: 100, y: 0, width: 200, height: 200, rotate: 0 })
  })

  it('pans with the pointer and never leaves the image', () => {
    // Dragging right shows more of the left side; at zoom 1 there is no room vertically.
    expect(cropOf(panView(start(), image, square, 25, 40), image, square)).toEqual({ x: 50, y: 0, width: 200, height: 200, rotate: 0 })
    expect(cropOf(panView(start(), image, square, 1000, 0), image, square).x).toBe(0)
    expect(cropOf(panView(start(), image, square, -1000, 0), image, square).x).toBe(200)
  })

  it('zooms around the center, 1x to 4x', () => {
    expect(cropOf(zoomView(start(), image, square, 2), image, square)).toEqual({ x: 150, y: 50, width: 100, height: 100, rotate: 0 })
    expect(zoomView(start(), image, square, 9).zoom).toBe(4)
    expect(zoomView(start(), image, square, 0.2).zoom).toBe(1)
  })

  it('turns a quarter clockwise around the center', () => {
    const turned = rotateView(start(), image, square)
    // 400x200 turned is 200x400: the frame covers its width, centered.
    expect(cropOf(turned, image, square)).toEqual({ x: 0, y: 100, width: 200, height: 200, rotate: 90 })
    let full = turned
    for (let i = 0; i < 3; i++) full = rotateView(full, image, square)
    expect(full.rotate).toBe(0)
  })

  it('goes back to a saved crop', () => {
    const saved = { x: 40, y: 60, width: 120, height: 120, rotate: 90 }
    expect(cropOf(viewOf(saved, image, square), image, square)).toEqual(saved)
  })

  it('lays the turned image out under the frame', () => {
    const zoomed = zoomView(start(), image, square, 2)
    const { left, top, box, img } = layoutOf(zoomed, image, square)
    expect({ left, top, box, img }).toEqual({ left: -150, top: -50, box: { width: 400, height: 200 }, img: { width: 400, height: 200 } })
    // Previews are the same view on a smaller frame.
    expect(layoutOf(zoomed, image, { width: 50, height: 50 }).left).toBe(-75)
  })
})
