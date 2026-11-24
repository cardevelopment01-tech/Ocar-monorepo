// What a driver has to switch on so their phone does not put Ocar to sleep. Android will not let an app change these itself and the app
// cannot read them, so this is a guide, not a check. The first step is the same on every phone; the rest depend on the make, because
// Xiaomi, Oppo, Vivo, Samsung and Huawei each add their own battery manager on top of Android's. Menu names move between phone versions,
// so the screen says so.
export type KeepRunningGuide = { title: string; steps: string[] }

const COMMON = 'Open battery settings below, find Ocar, and choose "Unrestricted" (or "Don\'t optimise")'

const BY_BRAND: Array<{ match: RegExp; title: string; extra: string[] }> = [
  { match: /xiaomi|redmi|poco/, title: 'Xiaomi / Redmi / Poco', extra: ['Open the Security app, then Permissions, then Autostart, and turn Ocar on', 'In Battery saver, set Ocar to "No restrictions"'] },
  { match: /oppo|realme|oneplus/, title: 'Oppo / Realme / OnePlus', extra: ['In Battery, open Ocar and allow background activity', 'Allow auto launch for Ocar'] },
  { match: /vivo|iqoo/, title: 'Vivo / iQOO', extra: ['In Battery, open Background power consumption, find Ocar, and choose "Allow"'] },
  { match: /samsung/, title: 'Samsung', extra: ['In Battery, open Background usage limits, then Never sleeping apps, and add Ocar'] },
  { match: /huawei|honor/, title: 'Huawei / Honor', extra: ['In Battery, open App launch, find Ocar, choose "Manage manually", and turn on all three switches'] },
]

export function keepRunningGuide(brand: string | null | undefined): KeepRunningGuide {
  const hit = BY_BRAND.find((b) => b.match.test((brand ?? '').toLowerCase()))
  return { title: hit?.title ?? 'Your phone', steps: [COMMON, ...(hit?.extra ?? [])] }
}
