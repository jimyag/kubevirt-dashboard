import { useEffect, useRef } from "react"

/**
 * Calls `callback` every `intervalMs` while the page is visible. Hidden tabs do not poll; when the
 * tab becomes visible again it refreshes at once instead of waiting for the next tick. The
 * initial load stays with the caller. `intervalMs` of 0 disables polling.
 */
export function usePolling(callback: () => void, intervalMs: number) {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })
  useEffect(() => {
    if (!intervalMs) return
    const tick = () => {
      if (!document.hidden) latest.current()
    }
    const timer = setInterval(tick, intervalMs)
    const onVisible = () => {
      if (!document.hidden) latest.current()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [intervalMs])
}
