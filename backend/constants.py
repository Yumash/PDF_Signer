"""Shared constants.

The frontend Konva stage falls back to A4 @ ~96dpi (794x1123) when a page's real
pixel size is unknown; the backend mirrors that fallback when a payload omits
stage dimensions. Keep both sides in sync via this single source (and its
frontend twin in src/constants.js).
"""

STAGE_FALLBACK_W = 794
STAGE_FALLBACK_H = 1123
