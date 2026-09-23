import type { ReactNode, SVGProps } from 'react'

export type IconGlyphProps = SVGProps<SVGSVGElement> & {
  size?: number
  viewBox?: string
  children: ReactNode
}

/** Corpo comum de todo ícone: traço fino consistente e herança de currentColor. */
export function IconGlyph({
  size = 20,
  viewBox = '0 0 24 24',
  children,
  ...props
}: IconGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}