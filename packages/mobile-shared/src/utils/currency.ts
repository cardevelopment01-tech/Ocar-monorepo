// Built once: constructing an Intl.NumberFormat is far costlier than calling format(), and this runs
// per history row / card / fare line on every render.
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export function formatCurrency(amountInRupees: number): string {
  return INR.format(amountInRupees)
}
