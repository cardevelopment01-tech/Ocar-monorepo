// Strings for the public trip page: English, Hindi, Odia. The page is opened by relatives, often on a modest Android phone,
// so every visible word has all three. Hindi and Odia are first drafts: have a native speaker read them before launch.

export type Lang = 'en' | 'hi' | 'or'
export const LANGS: ReadonlyArray<{ code: Lang; label: string; short: string }> = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'hi', label: 'हिन्दी', short: 'हि' },
  { code: 'or', label: 'ଓଡ଼ିଆ', short: 'ଓ' },
]
export const LOCALE_TAG: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', or: 'or-IN' }

const en = {
  'status.onWay': 'On the way to pickup',
  'status.onWayEta': 'On the way to pickup · {min} min',
  'status.inTrip': 'In trip',
  'status.inTripEta': 'In trip · Arriving {time}',
  'status.completed': 'Reached destination safely',
  'status.completedAt': 'Reached destination safely · {time}',
  'status.cancelled': 'Trip was cancelled',
  'status.finding': 'Finding a new driver…',
  'status.stale': 'Last seen {ago} ago',
  'status.updated': 'Updated {ago} ago',
  'status.staleAnnounce': 'The driver location is not updating',
  'headline.named': '{name} is on a trip',
  'headline.anon': 'A trip has been shared with you',
  'headline.completed': '{name} has reached safely',
  'headline.completedAnon': 'The trip ended safely',
  'headline.cancelled': "{name}'s trip was cancelled",
  'headline.cancelledAnon': 'This trip was cancelled',
  'headline.finding': 'Finding a new driver for {name}',
  'headline.findingAnon': 'Finding a new driver',
  'headline.onWay': "{name}'s cab is on the way",
  'headline.onWayAnon': 'The cab is on the way to pickup',
  'eta.onWay': 'Reaches pickup in {min} min',
  'eta.inTrip': 'Arriving {time}',
  'label.driver': 'Driver',
  'label.from': 'From',
  'label.to': 'To',
  'label.stops': 'Stops',
  'footer.shared': 'Shared via Ocar',
  'time.sec': '{n} sec',
  'time.min': '{n} min',
  'banner.reconnecting': 'Reconnecting…',
  'screen.loading': 'Loading trip…',
  'screen.inactiveTitle': 'This link is no longer active',
  'screen.inactiveBody': 'The trip has ended or the link was stopped.',
  'map.unavailable': 'Map unavailable. Status and location text below keep updating.',
  'map.label': 'Map showing the car on its route',
  'sos.banner': '{name} pressed SOS. Call them now, then call 112 if you cannot reach them.',
  'sos.bannerAnon': 'SOS was pressed on this trip. Call the rider now, then call 112 if you cannot reach them.',
  'sos.call112': 'Call 112',
  'sos.share': 'Share this link',
  'sos.copied': 'Link copied',
  'sheet.expand': 'Show trip details',
  'sheet.collapse': 'Hide trip details',
  'lang.label': 'Language',
} as const

export type StringKey = keyof typeof en

const hi: Record<StringKey, string> = {
  'status.onWay': 'पिकअप की ओर आ रहे हैं',
  'status.onWayEta': 'पिकअप की ओर · {min} मिनट',
  'status.inTrip': 'यात्रा जारी है',
  'status.inTripEta': 'यात्रा जारी · {time} तक पहुँचेंगे',
  'status.completed': 'सुरक्षित मंज़िल पर पहुँच गए',
  'status.completedAt': 'सुरक्षित मंज़िल पर पहुँचे · {time}',
  'status.cancelled': 'यात्रा रद्द हो गई',
  'status.finding': 'नया ड्राइवर ढूँढा जा रहा है…',
  'status.stale': 'आख़िरी बार {ago} पहले देखा गया',
  'status.updated': '{ago} पहले अपडेट हुआ',
  'status.staleAnnounce': 'ड्राइवर की लोकेशन अपडेट नहीं हो रही',
  'headline.named': '{name} यात्रा पर हैं',
  'headline.anon': 'आपके साथ एक यात्रा साझा की गई है',
  'headline.completed': '{name} सुरक्षित पहुँच गए',
  'headline.completedAnon': 'यात्रा सुरक्षित पूरी हुई',
  'headline.cancelled': '{name} की यात्रा रद्द हो गई',
  'headline.cancelledAnon': 'यह यात्रा रद्द हो गई',
  'headline.finding': '{name} के लिए नया ड्राइवर ढूँढा जा रहा है',
  'headline.findingAnon': 'नया ड्राइवर ढूँढा जा रहा है',
  'headline.onWay': '{name} की कैब आ रही है',
  'headline.onWayAnon': 'कैब पिकअप की ओर आ रही है',
  'eta.onWay': '{min} मिनट में पिकअप पर पहुँचेंगे',
  'eta.inTrip': '{time} तक पहुँचेंगे',
  'label.driver': 'ड्राइवर',
  'label.from': 'पिकअप',
  'label.to': 'मंज़िल',
  'label.stops': 'रुकने की जगहें',
  'footer.shared': 'Ocar के ज़रिए साझा',
  'time.sec': '{n} सेकंड',
  'time.min': '{n} मिनट',
  'banner.reconnecting': 'दोबारा जुड़ रहे हैं…',
  'screen.loading': 'यात्रा लोड हो रही है…',
  'screen.inactiveTitle': 'यह लिंक अब सक्रिय नहीं है',
  'screen.inactiveBody': 'यात्रा समाप्त हो गई है या लिंक बंद कर दिया गया है।',
  'map.unavailable': 'मानचित्र उपलब्ध नहीं है। नीचे दी गई स्थिति और लोकेशन की जानकारी अपडेट होती रहेगी।',
  'map.label': 'रास्ते पर गाड़ी दिखाने वाला मानचित्र',
  'sos.banner': '{name} ने SOS दबाया है। अभी उन्हें फ़ोन करें, और संपर्क न हो पाए तो 112 पर कॉल करें।',
  'sos.bannerAnon': 'इस यात्रा में SOS दबाया गया है। अभी यात्री को फ़ोन करें, और संपर्क न हो पाए तो 112 पर कॉल करें।',
  'sos.call112': '112 पर कॉल करें',
  'sos.share': 'यह लिंक साझा करें',
  'sos.copied': 'लिंक कॉपी हो गया',
  'sheet.expand': 'यात्रा का विवरण दिखाएँ',
  'sheet.collapse': 'विवरण छिपाएँ',
  'lang.label': 'भाषा',
}

const or: Record<StringKey, string> = {
  'status.onWay': 'ପିକଅପ୍ ଆଡ଼କୁ ଆସୁଛନ୍ତି',
  'status.onWayEta': 'ପିକଅପ୍ ଆଡ଼କୁ · {min} ମିନିଟ୍',
  'status.inTrip': 'ଯାତ୍ରା ଚାଲିଛି',
  'status.inTripEta': 'ଯାତ୍ରା ଚାଲିଛି · {time} ବେଳକୁ ପହଞ୍ଚିବେ',
  'status.completed': 'ନିରାପଦରେ ଗନ୍ତବ୍ୟସ୍ଥଳରେ ପହଞ୍ଚିଲେ',
  'status.completedAt': 'ନିରାପଦରେ ପହଞ୍ଚିଲେ · {time}',
  'status.cancelled': 'ଯାତ୍ରା ବାତିଲ୍ ହୋଇଛି',
  'status.finding': 'ନୂଆ ଡ୍ରାଇଭର ଖୋଜା ଯାଉଛି…',
  'status.stale': 'ଶେଷ ଥର {ago} ପୂର୍ବେ ଦେଖାଯାଇଥିଲା',
  'status.updated': '{ago} ପୂର୍ବେ ଅପଡେଟ୍ ହୋଇଛି',
  'status.staleAnnounce': 'ଡ୍ରାଇଭରଙ୍କ ଲୋକେସନ୍ ଅପଡେଟ୍ ହେଉନାହିଁ',
  'headline.named': '{name} ଯାତ୍ରାରେ ଅଛନ୍ତି',
  'headline.anon': 'ଆପଣଙ୍କ ସହିତ ଏକ ଯାତ୍ରା ସେୟାର୍ କରାଯାଇଛି',
  'headline.completed': '{name} ସୁରକ୍ଷିତ ଭାବେ ପହଞ୍ଚିଛନ୍ତି',
  'headline.completedAnon': 'ଯାତ୍ରା ସୁରକ୍ଷିତ ଭାବେ ଶେଷ ହେଲା',
  'headline.cancelled': '{name}ଙ୍କ ଯାତ୍ରା ବାତିଲ୍ ହୋଇଛି',
  'headline.cancelledAnon': 'ଏହି ଯାତ୍ରା ବାତିଲ୍ ହୋଇଛି',
  'headline.finding': '{name}ଙ୍କ ପାଇଁ ନୂଆ ଡ୍ରାଇଭର ଖୋଜା ଯାଉଛି',
  'headline.findingAnon': 'ନୂଆ ଡ୍ରାଇଭର ଖୋଜା ଯାଉଛି',
  'headline.onWay': '{name}ଙ୍କ କ୍ୟାବ୍ ଆସୁଛି',
  'headline.onWayAnon': 'କ୍ୟାବ୍ ପିକଅପ୍ ଆଡ଼କୁ ଆସୁଛି',
  'eta.onWay': '{min} ମିନିଟରେ ପିକଅପ୍‌ରେ ପହଞ୍ଚିବ',
  'eta.inTrip': '{time} ବେଳକୁ ପହଞ୍ଚିବେ',
  'label.driver': 'ଡ୍ରାଇଭର',
  'label.from': 'ପିକଅପ୍',
  'label.to': 'ଗନ୍ତବ୍ୟ',
  'label.stops': 'ବିରତି ସ୍ଥାନ',
  'footer.shared': 'Ocar ମାଧ୍ୟମରେ ସେୟାର୍',
  'time.sec': '{n} ସେକେଣ୍ଡ',
  'time.min': '{n} ମିନିଟ୍',
  'banner.reconnecting': 'ପୁଣି ସଂଯୋଗ ହେଉଛି…',
  'screen.loading': 'ଯାତ୍ରା ଲୋଡ୍ ହେଉଛି…',
  'screen.inactiveTitle': 'ଏହି ଲିଙ୍କ୍ ଆଉ ସକ୍ରିୟ ନାହିଁ',
  'screen.inactiveBody': 'ଯାତ୍ରା ସମାପ୍ତ ହୋଇଛି କିମ୍ବା ଲିଙ୍କ୍ ବନ୍ଦ କରାଯାଇଛି।',
  'map.unavailable': 'ମାନଚିତ୍ର ଉପଲବ୍ଧ ନାହିଁ। ତଳେ ଥିବା ସ୍ଥିତି ଓ ଲୋକେସନ୍ ସୂଚନା ଅପଡେଟ୍ ହେଉଥିବ।',
  'map.label': 'ରାସ୍ତାରେ ଗାଡ଼ି ଦେଖାଉଥିବା ମାନଚିତ୍ର',
  'sos.banner': '{name} SOS ଦବାଇଛନ୍ତି। ଏବେ ସେମାନଙ୍କୁ ଫୋନ୍ କରନ୍ତୁ, ଯୋଗାଯୋଗ ନ ହେଲେ 112 କୁ କଲ୍ କରନ୍ତୁ।',
  'sos.bannerAnon': 'ଏହି ଯାତ୍ରାରେ SOS ଦବାଯାଇଛି। ଏବେ ଯାତ୍ରୀଙ୍କୁ ଫୋନ୍ କରନ୍ତୁ, ଯୋଗାଯୋଗ ନ ହେଲେ 112 କୁ କଲ୍ କରନ୍ତୁ।',
  'sos.call112': '112 କୁ କଲ୍ କରନ୍ତୁ',
  'sos.share': 'ଏହି ଲିଙ୍କ୍ ସେୟାର୍ କରନ୍ତୁ',
  'sos.copied': 'ଲିଙ୍କ୍ କପି ହୋଇଛି',
  'sheet.expand': 'ଯାତ୍ରା ବିବରଣୀ ଦେଖାନ୍ତୁ',
  'sheet.collapse': 'ବିବରଣୀ ଲୁଚାନ୍ତୁ',
  'lang.label': 'ଭାଷା',
}

export const STRINGS: Record<Lang, Record<StringKey, string>> = { en, hi, or }

export function t(lang: Lang, key: StringKey, vars: Record<string, string | number> = {}): string {
  return STRINGS[lang][key].replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'hi' || v === 'or'

/** First language: `?lang=` on the link, then the viewer's saved choice, then the browser's languages, then English. */
export function pickLanguage(input: { queryLang?: string | null; stored?: string | null; browserLanguages?: readonly string[] }): Lang {
  if (isLang(input.queryLang)) return input.queryLang
  if (isLang(input.stored)) return input.stored
  for (const tag of input.browserLanguages ?? []) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLang(base)) return base
  }
  return 'en'
}
