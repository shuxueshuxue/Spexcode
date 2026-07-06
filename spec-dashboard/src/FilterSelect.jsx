// The ONE dropdown filter the list pickers share: the Issues drain's store filter and the evals feed's
// kind filter are this single control ([[issues-view]] / [[evals-feed]]) — one implementation, one look,
// so the two top-level pickers can never drift apart on chrome.
export default function FilterSelect({ value, onChange, options }) {
  return (
    <select className="fv-filter" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
