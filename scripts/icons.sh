#!/bin/sh
# Rasterizes the SVG marks in public/ into the PNG icons the manifest and
# iOS need. Requires rsvg-convert (librsvg). Run from the repository root.
set -eu
cd public
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-maskable-512.png
# iOS fills transparent pixels with black, so the touch icon is full-bleed.
rsvg-convert -w 180 -h 180 icon-maskable.svg -o apple-touch-icon.png
