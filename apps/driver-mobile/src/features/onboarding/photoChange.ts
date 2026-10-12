// Replacing an approved profile photo sends it back for review, and a required document under review
// blocks going online until an admin approves it. Only warn in that case: a missing, pending or
// rejected photo is already unreviewed (or blocking), so changing it costs the driver nothing new.
export function shouldWarnBeforePhotoChange(docStatus: string | null | undefined): boolean {
  return docStatus === 'approved'
}

export const PHOTO_CHANGE_WARNING = {
  title: 'Change your profile photo?',
  body: "A new photo has to be approved by our team first. You won't be able to go online until it's reviewed, usually within 1 to 2 business days.",
} as const
