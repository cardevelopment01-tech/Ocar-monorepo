import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { DRIVER_DOC_GROUPS, VEHICLE_DOC_GROUPS } from '../constants'
import { Field, FieldError, TextField } from './FormPrimitives'
import { DateField } from './DateField'
import { DocSlot } from './DocSlot'
import type { DocumentsForm } from '../useDocumentsForm'

/** Identity numbers + every driver/vehicle document slot, the shared body of the onboarding wizard's
 *  Documents step and the standalone Documents screen (Profile / Home banner / push notification). */
export function DocumentsFields({ form }: { form: DocumentsForm }) {
  return (
    <>
      <View style={styles.identityCard}>
        <View style={styles.cardHeader}>
          <Feather name="shield" size={15} color={colors.primary} />
          <Text style={styles.cardTitle}>Identity Numbers</Text>
          {form.identitySaved ? <Feather name="check-circle" size={15} color={colors.success} /> : null}
        </View>
        <Field label="Driving Licence Number">
          <TextField
            value={form.licenseNumber}
            onChangeText={form.setLicenseNumber}
            onBlur={form.trySaveIdentity}
            placeholder="OD0519910012345"
            autoCapitalize="characters"
            maxLength={16}
          />
        </Field>
        <Field label="Aadhaar Number" hint="12-digit number on your Aadhaar card">
          <TextField
            value={form.aadhaarNumber}
            onChangeText={form.setAadhaarNumber}
            onBlur={form.trySaveIdentity}
            placeholder="XXXXXXXXXXXX"
            keyboardType="number-pad"
            maxLength={12}
          />
        </Field>
        <FieldError message={form.identityError} />
      </View>

      <Text style={styles.sectionLabel}>DRIVER DOCUMENTS</Text>
      {DRIVER_DOC_GROUPS.map((group) => (
        <View key={group.groupKey} style={styles.groupCard}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          {group.slots.map((slot) => (
            <DocSlot
              key={slot.key}
              label={slot.slotLabel || group.label}
              state={form.slotState[slot.key]?.state ?? 'idle'}
              thumbnailUrl={form.slotState[slot.key]?.url ?? null}
              docStatus={form.slotState[slot.key]?.docStatus}
              rejectionNote={form.slotState[slot.key]?.rejectionNote}
              error={form.slotState[slot.key]?.error}
              onPick={(file) => void form.handlePick(slot.key, group.groupKey, false, file)}
            />
          ))}
          {group.hasExpiry ? (
            <DateField label="Valid Until" value={form.validUntil[group.groupKey] ?? ''} onChange={(v) => form.setValidUntil((prev) => ({ ...prev, [group.groupKey]: v }))} placeholder="Select expiry date" />
          ) : null}
        </View>
      ))}

      <Text style={styles.sectionLabel}>VEHICLE DOCUMENTS</Text>
      {VEHICLE_DOC_GROUPS.map((group) => (
        <View key={group.groupKey} style={styles.groupCard}>
          <View style={styles.groupHeaderRow}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {!group.required ? <Text style={styles.optionalBadge}>Optional</Text> : null}
          </View>
          {group.slots.map((slot) => (
            <DocSlot
              key={slot.key}
              label={slot.slotLabel || group.label}
              state={form.slotState[slot.key]?.state ?? 'idle'}
              thumbnailUrl={form.slotState[slot.key]?.url ?? null}
              docStatus={form.slotState[slot.key]?.docStatus}
              rejectionNote={form.slotState[slot.key]?.rejectionNote}
              error={form.slotState[slot.key]?.error}
              onPick={(file) => void form.handlePick(slot.key, group.groupKey, form.vehicleDocKeys.has(slot.key), file)}
            />
          ))}
          {group.hasExpiry ? (
            <DateField label="Valid Until" value={form.validUntil[group.groupKey] ?? ''} onChange={(v) => form.setValidUntil((prev) => ({ ...prev, [group.groupKey]: v }))} placeholder="Select expiry date" />
          ) : null}
        </View>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  identityCard: { backgroundColor: colors.surface2, borderRadius: radii.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, flex: 1 },
  sectionLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold, letterSpacing: 1, marginTop: spacing.sm },
  groupCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupLabel: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  optionalBadge: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
})
