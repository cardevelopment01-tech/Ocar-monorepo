// What goes into the two trip-share SMS wordings (`trip_share`, `sos_contact_live`). They are DLT templates: the fixed text, including
// the whitelisted domain and the path `/t/`, is registered with the SMS vendor, and only short `{#var#}` slots may vary. So the text
// carries the link's token, not the whole URL, and a name must fit a slot. See docs/DLT_TEMPLATES_TRIP_SHARE.md.

/** The longest a single DLT `{#var#}` value may be. */
export const DLT_VARIABLE_MAX = 30

/** A name as a DLT variable: never longer than a slot holds, or the operator rejects the whole message. */
export const dltVariable = (value: string): string => value.trim().slice(0, DLT_VARIABLE_MAX).trim()

/** The token at the end of a share URL (`<USER_APP_URL>/t/<token>`). */
export const shareTokenFromUrl = (url: string): string => url.slice(url.lastIndexOf('/') + 1)
