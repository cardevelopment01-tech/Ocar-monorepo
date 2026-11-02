import { AlertTriangle, Info } from 'lucide-react'

// Building blocks for policy text. Policy sections stay plain React so a lawyer can edit the words
// without touching layout; these only add structure (tables, notices) where prose alone is hard to scan.

export function Callout({
  title,
  tone = 'info',
  children,
}: {
  title?: string
  tone?: 'info' | 'warning'
  children: React.ReactNode
}) {
  const Icon = tone === 'warning' ? AlertTriangle : Info
  return (
    <div
      className={
        tone === 'warning'
          ? 'flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5'
          : 'flex gap-3 rounded-2xl border border-border bg-surface-2 p-4 sm:p-5'
      }
    >
      <Icon
        aria-hidden
        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${tone === 'warning' ? 'text-amber-700' : 'text-primary-dark'}`}
      />
      <div className="min-w-0 space-y-2 text-[15px] leading-[1.7] text-text-primary">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  )
}

// A table that scrolls sideways on a phone instead of squashing three columns into unreadable strips.
export function DataTable({
  caption,
  head,
  rows,
  widths,
}: {
  caption: string
  head: string[]
  rows: React.ReactNode[][]
  /** Column widths, e.g. ['24%', '56%', '20%']. Defaults to a 28% first column. */
  widths?: string[]
}) {
  return (
    <div className="-mx-1 overflow-x-auto rounded-2xl border border-border px-1 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[14.5px] leading-[1.6]">
        <caption className="sr-only">{caption}</caption>
        {widths ? (
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr className="bg-surface-2 text-[13px] text-text-primary">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className={`px-4 py-3.5 font-semibold text-text-primary ${widths ? '' : 'w-[28%]'}`}>
                    {cell}
                  </th>
                ) : (
                  <td key={j} className="px-4 py-3.5 text-text-secondary">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
