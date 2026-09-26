import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { PulseDot, colors, fonts, spacing, typography, Text } from '@ocar/mobile-shared'
import { DocumentsFields } from '@/features/onboarding/components/DocumentsFields'
import { useDocumentsForm } from '@/features/onboarding/useDocumentsForm'

/**
 * Standalone Documents screen. Reachable at any time from the Profile menu, the Home rejection
 * banner, and the document_rejected push notification. Every upload saves immediately, and the
 * banner at the top states the current review status and, for rejected documents, the reason.
 */
export default function DocumentsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const form = useDocumentsForm()

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={18} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title}>Documents</Text>
      </View>

      {form.isFetching ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ComplianceBanner rejectedCount={form.rejectedDocs.length} pendingCount={form.pendingCount} />

          {form.rejectedDocs.length > 0 ? (
            <View style={styles.alertCard}>
              <View style={styles.alertHeaderRow}>
                <PulseDot color={colors.error} size={8} />
                <Text style={styles.alertTitle}>
                  {form.rejectedDocs.length === 1 ? '1 document needs your attention' : `${form.rejectedDocs.length} documents need your attention`}
                </Text>
              </View>
              {form.rejectedDocs.map((d) => (
                <View key={d.key} style={styles.alertRow}>
                  <Text style={styles.alertDocName}>{d.label}</Text>
                  {d.note ? <Text style={styles.alertNote}>{d.note}</Text> : null}
                  {d.count >= 3 ? (
                    <Text style={styles.alertEscalation}>Rejected {d.count} times. Our support team has been notified. Scroll down to reupload, or contact support if you need help.</Text>
                  ) : d.count === 2 ? (
                    <Text style={styles.alertEscalation}>This is the 2nd time. Check the requirements carefully before resubmitting.</Text>
                  ) : null}
                </View>
              ))}
              <Text style={styles.alertHint}>Scroll down, tap the highlighted document, and upload a replacement. It goes straight back to review.</Text>
            </View>
          ) : null}

          <DocumentsFields form={form} />
        </ScrollView>
      )}
    </View>
  )
}

function ComplianceBanner({ rejectedCount, pendingCount }: { rejectedCount: number; pendingCount: number }) {
  if (rejectedCount > 0) {
    return (
      <View style={[styles.banner, styles.bannerError]}>
        <PulseDot color={colors.error} size={8} />
        <Text style={[styles.bannerText, styles.bannerTextError]}>Action needed. You cannot go online until this is fixed.</Text>
      </View>
    )
  }
  if (pendingCount > 0) {
    return (
      <View style={[styles.banner, styles.bannerWarn]}>
        <Feather name="clock" size={16} color="#8A6420" />
        <Text style={[styles.bannerText, styles.bannerTextWarn]}>
          {pendingCount === 1 ? '1 document is being reviewed' : `${pendingCount} documents are being reviewed`}. Reviews usually take 1 to 2 business days.
        </Text>
      </View>
    )
  }
  return (
    <View style={[styles.banner, styles.bannerOk]}>
      <Feather name="check-circle" size={16} color={colors.success} />
      <Text style={[styles.bannerText, styles.bannerTextOk]}>All documents verified</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(20,23,26,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headline, fontSize: 20, color: colors.ink900, fontFamily: fonts.bold },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, borderRadius: 16, borderWidth: 1, padding: spacing.md },
  bannerError: { backgroundColor: colors.errorLight, borderColor: colors.error },
  bannerWarn: { backgroundColor: colors.warningLight, borderColor: colors.warning },
  bannerOk: { backgroundColor: colors.successLight, borderColor: colors.success },
  bannerText: { ...typography.body, fontFamily: fonts.semibold, flex: 1 },
  bannerTextError: { color: colors.error },
  bannerTextWarn: { color: '#8A6420' },
  bannerTextOk: { color: colors.success },
  alertCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.error, borderRadius: 20, padding: spacing.md, gap: spacing.sm },
  alertHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  alertTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  alertRow: { paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.errorLight, gap: 2 },
  alertDocName: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  alertNote: { ...typography.caption, color: colors.ink600 },
  alertEscalation: { ...typography.caption, color: colors.error, fontFamily: fonts.semibold, marginTop: 2 },
  alertHint: { ...typography.caption, color: colors.ink400, marginTop: 2 },
})
