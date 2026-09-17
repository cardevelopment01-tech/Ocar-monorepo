import { useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import type { PickedFile } from '../api'

export type DocSlotState = 'idle' | 'uploading' | 'done' | 'error'

export type DocSlotProps = {
  label: string
  state: DocSlotState
  thumbnailUrl: string | null
  docStatus?: string | null
  rejectionNote?: string | null
  error?: string | null
  onPick: (file: PickedFile) => void
}

// Phone-camera photos are commonly 4-12MB; expo-image-picker's own `quality`
// (JPEG re-encode at capture/pick time) does the downscaling web's separate
// canvas-based compressImage() step handles -- no extra native module needed.
const PICK_QUALITY = 0.7

async function pickFrom(source: 'camera' | 'library'): Promise<PickedFile | null> {
  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) return null

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ quality: PICK_QUALITY, allowsEditing: false, exif: false })
    : await ImagePicker.launchImageLibraryAsync({ quality: PICK_QUALITY, allowsEditing: false, mediaTypes: ['images'] })

  if (result.canceled || !result.assets[0]) return null
  const asset = result.assets[0]
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', fileSize: asset.fileSize ?? 0 }
}

export function DocSlot({ label, state, thumbnailUrl, docStatus, rejectionNote, error, onPick }: DocSlotProps) {
  const [busy, setBusy] = useState(false)

  function handlePress() {
    Alert.alert(label, 'Choose a photo source', [
      { text: 'Take Photo', onPress: () => void handlePick('camera') },
      { text: 'Choose from Gallery', onPress: () => void handlePick('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function handlePick(source: 'camera' | 'library') {
    setBusy(true)
    try {
      const file = await pickFrom(source)
      if (file) onPick(file)
    } finally {
      setBusy(false)
    }
  }

  const rejected = docStatus === 'rejected'
  const uploading = state === 'uploading' || busy

  return (
    <Pressable onPress={handlePress} disabled={uploading} style={[styles.slot, rejected ? styles.slotRejected : null]}>
      {thumbnailUrl ? (
        <Image source={{ uri: thumbnailUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Feather name="camera" size={18} color={colors.ink400} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {uploading ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.statusText}>Uploading…</Text>
          </View>
        ) : state === 'done' ? (
          <View style={styles.statusRow}>
            <Feather name={rejected ? 'alert-circle' : 'check-circle'} size={12} color={rejected ? colors.error : colors.success} />
            <Text style={[styles.statusText, rejected ? styles.statusRejected : styles.statusDone]}>
              {rejected ? 'Rejected — tap to reupload' : docStatus === 'pending' ? 'Pending review' : 'Uploaded'}
            </Text>
          </View>
        ) : error ? (
          <Text style={styles.statusRejected}>{error}</Text>
        ) : (
          <Text style={styles.statusMuted}>Tap to upload</Text>
        )}
        {rejected && rejectionNote ? <Text style={styles.rejectionNote}>{rejectionNote}</Text> : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.ink400} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  slot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radii.lg, padding: spacing.sm + 4, borderWidth: 1, borderColor: colors.border },
  slotRejected: { borderColor: colors.error },
  thumb: { width: 48, height: 48, borderRadius: radii.md },
  thumbEmpty: { backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  statusText: { ...typography.caption },
  statusMuted: { ...typography.caption, color: colors.ink400, marginTop: 2 },
  statusDone: { color: colors.success, fontWeight: '600' },
  statusRejected: { ...typography.caption, color: colors.error, fontWeight: '600', marginTop: 2 },
  rejectionNote: { ...typography.caption, color: colors.ink400, marginTop: 2 },
})
