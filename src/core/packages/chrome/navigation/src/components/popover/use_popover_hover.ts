/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useCallback, useRef } from 'react';
import { useHoverTimeout } from '../../hooks/use_hover_timeout';
import { POPOVER_HOVER_DELAY } from '../../constants';

/**
 * Hook for mouse interactions with safe polygon hover
 */
export const usePopoverHover = (
  persistent: boolean,
  isOpenedByClick: boolean,
  isSidePanelOpen: boolean,
  { open, close }: { open: () => void; close: () => void },
  options?: {
    triggerRef?: React.RefObject<HTMLElement>;
    popoverRef?: React.RefObject<HTMLElement>;
  }
) => {
  const { setTimeout, clearTimeout } = useHoverTimeout();
  const leavePoint = useRef<{ x: number; y: number } | null>(null);
  const tracking = useRef(false);
  const polygonTimeout = useRef<number | null>(null);

  // Helper: check if point is inside triangle (using barycentric coordinates)
  function isPointInTriangle(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
  ) {
    const area = 0.5 * (-b.y * c.x + a.y * (-b.x + c.x) + a.x * (b.y - c.y) + b.x * c.y);
    const s = (1 / (2 * area)) * (a.y * c.x - a.x * c.y + (c.y - a.y) * p.x + (a.x - c.x) * p.y);
    const t = (1 / (2 * area)) * (a.x * b.y - a.y * b.x + (a.y - b.y) * p.x + (b.x - a.x) * p.y);
    const u = 1 - s - t;
    return s >= 0 && t >= 0 && u >= 0;
  }

  // Mouse move handler for safe polygon
  const handleDocumentMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!tracking.current || !leavePoint.current || !options?.popoverRef?.current) return;
      const popoverRect = options.popoverRef.current.getBoundingClientRect();
      // For right-side popover: triangle from leavePoint to popover's top-left and bottom-left
      const a = leavePoint.current;
      const b = { x: popoverRect.left, y: popoverRect.top };
      const c = { x: popoverRect.left, y: popoverRect.bottom };
      const p = { x: event.clientX, y: event.clientY };
      if (
        isPointInTriangle(p, a, b, c) ||
        (event.target && options.popoverRef.current.contains(event.target as Node))
      ) {
        // Still moving toward popover or inside popover, do nothing
        if (polygonTimeout.current) {
          window.clearTimeout(polygonTimeout.current);
          polygonTimeout.current = null;
        }
      } else {
        // Not moving toward popover, close after delay
        if (!polygonTimeout.current) {
          polygonTimeout.current = window.setTimeout(() => {
            tracking.current = false;
            leavePoint.current = null;
            close();
          }, POPOVER_HOVER_DELAY);
        }
      }
    },
    [close, options]
  );

  const handleMouseEnter = useCallback(() => {
    if (!persistent || !isOpenedByClick) {
      clearTimeout();
      if (!isSidePanelOpen) {
        open();
      }
    }
    // Stop tracking when mouse re-enters
    tracking.current = false;
    leavePoint.current = null;
    if (options?.triggerRef && options?.popoverRef) {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
    }
  }, [
    persistent,
    isOpenedByClick,
    isSidePanelOpen,
    clearTimeout,
    open,
    options,
    handleDocumentMouseMove,
  ]);

  const handleMouseLeave = useCallback(
    (e?: React.MouseEvent) => {
      if (!persistent || !isOpenedByClick) {
        // Start tracking mouse if leaving trigger toward popover
        if (options?.triggerRef?.current && options?.popoverRef?.current && e) {
          const { clientX: x, clientY: y } = e;
          leavePoint.current = { x, y };
          tracking.current = true;
          document.addEventListener('mousemove', handleDocumentMouseMove);
        } else {
          setTimeout(close, POPOVER_HOVER_DELAY);
        }
      }
    },
    [persistent, isOpenedByClick, setTimeout, close, options, handleDocumentMouseMove]
  );

  // Clean up on unmount
  React.useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      if (polygonTimeout.current) {
        window.clearTimeout(polygonTimeout.current);
        polygonTimeout.current = null;
      }
      tracking.current = false;
      leavePoint.current = null;
    };
  }, [handleDocumentMouseMove]);

  return { handleMouseEnter, handleMouseLeave, clearTimeout };
};
