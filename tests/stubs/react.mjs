/**
 * Test-only react stub. The real `react` is a host-provided external peer
 * (never installed in this repo — see tsdown externals), so vitest cannot
 * resolve it when a test pulls in a React-touching client module. Typechecking
 * still uses @types/react; this stub only satisfies module evaluation for
 * headless logic tests that never render.
 */
export function createElement(type, props, ...children) {
  return { type, props: props ?? null, children }
}

export function useState(initial) {
  const value = typeof initial === 'function' ? initial() : initial
  return [value, () => undefined]
}

export function useEffect() {
  return undefined
}

export default { createElement, useState, useEffect }
