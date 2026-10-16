// List totals from the API are capped at 10,000 rows (counting every row is a full scan). When capped, the number is
// a lower bound, so it is shown as "10,000+" and the pager keeps going while pages come back full.
export const CAPPED_TOTAL_HINT = 'Counting stops at 10,000. Narrow the filters for an exact number.'

export function formatTotal(total: number, capped: boolean): string {
  return `${total.toLocaleString('en-IN')}${capped ? '+' : ''}`
}

export function hasNextPage(opts: { page: number; pages: number; capped: boolean; rowsOnPage: number; limit: number }): boolean {
  // capped: the real page count is unknown, so Next stays available as long as this page was full
  return opts.capped ? opts.rowsOnPage >= opts.limit : opts.page < opts.pages
}
