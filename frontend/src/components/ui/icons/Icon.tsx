import type { ReactNode, SVGProps } from 'react'
import { IconGlyph as Glyph } from './IconGlyph'

/**
 * Ícones da interface — SVG inline, traço fino e consistente (1.6px),
 * herdam `currentColor`. Sem biblioteca externa, sem emojis como elemento
 * de UI. Uso discreto e funcional apenas.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

let seq = 0
function withGlyph(render: (props: IconProps) => ReactNode) {
  const icon = (props: IconProps) => <>{render(props)}</>
  seq += 1
  icon.displayName = `Icon${seq}`
  return icon
}

export const CalendarIcon = withGlyph((props) => (
  <Glyph {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </Glyph>
))

export const ClockIcon = withGlyph((props) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </Glyph>
))

export const ScissorsIcon = withGlyph((props) => (
  <Glyph {...props}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.5 15.5M8.5 8.5 20 20" />
  </Glyph>
))

export const UserIcon = withGlyph((props) => (
  <Glyph {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6.5 8-6.5S20 17 20 21" />
  </Glyph>
))

export const UsersIcon = withGlyph((props) => (
  <Glyph {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 21c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M21 21c0-3-1.8-4.7-4.5-5.2" />
  </Glyph>
))

export const BellIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" />
    <path d="M10 18a2 2 0 0 0 4 0" />
  </Glyph>
))

export const MessageIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />
  </Glyph>
))

export const ListIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Glyph>
))

export const GridIcon = withGlyph((props) => (
  <Glyph {...props}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Glyph>
))

export const TagIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M3.5 12.5 11 5a2 2 0 0 1 1.4-.6H19a1.5 1.5 0 0 1 1.5 1.5v6.6a2 2 0 0 1-.6 1.4l-7.5 7.5a1.5 1.5 0 0 1-2.1 0l-6.8-6.8a1.5 1.5 0 0 1 0-2.1Z" />
    <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
  </Glyph>
))

export const BlockIcon = withGlyph((props) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6 18.4 18.4" />
  </Glyph>
))

export const CheckIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M4.5 12.5 9.5 17.5 19.5 7" />
  </Glyph>
))

export const XIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M6 6 18 18M18 6 6 18" />
  </Glyph>
))

export const ChevronDownIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M6 9.5 12 15.5 18 9.5" />
  </Glyph>
))

export const ChevronLeftIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M15 6 9 12l6 6" />
  </Glyph>
))

export const ChevronRightIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M9 6l6 6-6 6" />
  </Glyph>
))

export const MenuIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Glyph>
))

export const LogoutIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 12H3M7 8l-4 4 4 4" />
  </Glyph>
))

export const PlusIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
))

export const SearchIcon = withGlyph((props) => (
  <Glyph {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Glyph>
))

export const SpinnerIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Glyph>
))

export const InfoIcon = withGlyph((props) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Glyph>
))

export const AlertIcon = withGlyph((props) => (
  <Glyph {...props}>
    <path d="M12 3 2.5 20h19L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </Glyph>
))
