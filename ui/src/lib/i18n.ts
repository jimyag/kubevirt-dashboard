import { useSyncExternalStore } from "react"

import { zh } from "./locales/zh"

/**
 * Minimal i18n: UI strings are written in English and used as keys, so a missing translation
 * falls back to the English text. `t("Delete {name}?", { name })` interpolates `{name}`.
 *
 * Switching language remounts the app (see App.tsx), so `t()` can be called anywhere at render
 * time. Do not call it at module level: those values would keep the first language.
 */

export type Locale = "en" | "zh"

export const locales: Array<{ id: Locale; label: string }> = [
  { id: "en", label: "English" },
  { id: "zh", label: "简体中文" },
]

const dictionaries: Record<Locale, Record<string, string>> = { en: {}, zh }

const storageKey = "locale"

const detect = (): Locale => {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === "en" || stored === "zh") return stored
  } catch {
    // Storage may be unavailable; fall back to the browser language.
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"
}

let current: Locale = detect()
const listeners = new Set<() => void>()

const applyDocumentLang = () => {
  if (typeof document !== "undefined") document.documentElement.lang = current === "zh" ? "zh-CN" : "en"
}
applyDocumentLang()

export const getLocale = () => current

/** BCP 47 tag for Intl / toLocaleString, following the console language rather than the browser. */
export const dateLocale = () => (current === "zh" ? "zh-CN" : "en-US")

export function t(text: string, vars?: Record<string, string | number | undefined | null>): string
export function t(text: string | undefined, vars?: Record<string, string | number | undefined | null>): string | undefined
export function t(text: string | undefined, vars?: Record<string, string | number | undefined | null>) {
  if (text === undefined) return undefined
  const template = dictionaries[current][text] ?? text
  return vars ? template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key] ?? "") : match)) : template
}

export const setLocale = (locale: Locale) => {
  if (locale === current) return
  current = locale
  try {
    localStorage.setItem(storageKey, locale)
  } catch {
    // The choice then lasts for this page view only.
  }
  applyDocumentLang()
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale)
}
