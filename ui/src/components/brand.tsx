import { cn } from "@/lib/utils"

export const productName = "KubeVirt Dashboard"

/**
 * Product mark, same drawing as public/favicon.svg but following the theme's primary color.
 * Wrapped in a span because sidebar buttons force direct svg children to icon size.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-7 shrink-0", className)}>
      <svg viewBox="0 0 32 32" aria-hidden className="size-full">
        <rect width="32" height="32" rx="7" className="fill-primary" />
        <path d="M16 5 26.5 10.9 16 16.8 5.5 10.9Z" className="fill-primary-foreground" />
        <path d="M5.5 10.9 16 16.8V27.5L5.5 21.6Z" className="fill-primary-foreground" fillOpacity={0.72} />
        <path d="M26.5 10.9V21.6L16 27.5V16.8Z" className="fill-primary-foreground" fillOpacity={0.46} />
      </svg>
    </span>
  )
}
