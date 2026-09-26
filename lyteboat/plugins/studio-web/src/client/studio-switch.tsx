/**
 * The Studio's on/off switch, drawn as the original Studio draws it: a
 * `role="switch"` button whose knob slides right when on.
 * @module @lyteboat/studio-web/client/studio-switch
 */

/** A switch named `label` for assistive technology. */
export function StudioSwitch({ checked, disabled = false, label, onChange }: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange(checked: boolean): void
}) {
  return (
    <button aria-checked={checked} aria-label={label} className={`ui-switch ${checked ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} role="switch" type="button">
      <span className="ui-switch-knob" />
    </button>
  )
}
