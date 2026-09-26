/**
 * The Studio's inline icons, drawn as the original Studio draws them: a 24×24
 * view box, 1.8 stroke, `currentColor`, hidden from assistive technology.
 * @module @lyteboat/studio-web/client/studio-icons
 */

import type { SVGProps } from 'react'

type StudioIconProps = SVGProps<SVGSVGElement>

function StudioIconBase(props: StudioIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="20"
      {...props}
    />
  )
}

export function OverviewIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="M3 12.5 12 4l9 8.5" />
      <path d="M5.5 10.5V20h13V10.5" />
      <path d="M9.5 20v-5h5v5" />
    </StudioIconBase>
  )
}

export function UsersIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </StudioIconBase>
  )
}

export function SearchIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </StudioIconBase>
  )
}

export function PlusIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </StudioIconBase>
  )
}

export function RefreshIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M19 11a7 7 0 0 0-12-3l-2 3" />
      <path d="M5 13a7 7 0 0 0 12 3l2-3" />
    </StudioIconBase>
  )
}

export function LogoutIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </StudioIconBase>
  )
}

export function SparkIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="m5 17 1 3" />
      <path d="m18 16 1 3" />
    </StudioIconBase>
  )
}

export function CloseIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </StudioIconBase>
  )
}

export function SunIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </StudioIconBase>
  )
}

export function MoonIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </StudioIconBase>
  )
}

export function AlertIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="M12 3 2 21h20Z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none" />
    </StudioIconBase>
  )
}

export function CheckIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <path d="m4 12 5 5L20 6" />
    </StudioIconBase>
  )
}

export function ServerIcon(props: StudioIconProps) {
  return (
    <StudioIconBase {...props}>
      <rect height="5.5" rx="1.5" width="20" x="2" y="2.5" />
      <rect height="5.5" rx="1.5" width="20" x="2" y="10" />
      <rect height="4" rx="1.5" width="20" x="2" y="17.5" />
      <circle cx="18" cy="5.25" fill="currentColor" r="1" stroke="none" />
      <circle cx="18" cy="12.75" fill="currentColor" r="1" stroke="none" />
    </StudioIconBase>
  )
}
