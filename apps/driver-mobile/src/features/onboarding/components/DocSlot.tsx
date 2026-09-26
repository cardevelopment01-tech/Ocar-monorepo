import { useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { getInfoAsync } from 'expo-file-system/legacy'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
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

// Phone-camera photos are commonly 4-12MB. `quality` only re-encodes (it never
// shrinks dimensions); the 1600px downscale happens at upload time in
// services/uploadImage.ts, mirroring web's compressDocImage().
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
  // asset.fileSize is unreliable after the quality re-encode above (often
  // undefined on Android) -- a wrong content_length signs the presigned S3
  // PUT for the wrong byte count, so S3 rejects the real upload with a
  // signature mismatch. Read the actual re-encoded file's size instead.
  const info = await getInfoAsync(asset.uri)
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', fileSize: info.exists ? (info.size ?? 0) : (asset.fileSize ?? 0) }
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
    <Pressable
      onPress={handlePress}
      disabled={uploading}
      style={({ pressed }) => [styles.slot, rejected ? styles.slotRejected : null, pressed && !uploading ? styles.pressedScale : null]}
    >
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
              {rejected ? 'Rejected. Tap to reupload' : docStatus === 'pending' ? 'Pending review' : docStatus === 'approved' ? 'Verified' : 'Uploaded'}
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
  slot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.sm + 4 },
  slotRejected: { borderWidth: 1, borderColor: colors.error },
  thumb: { width: 48, height: 48, borderRadius: radii.md },
  thumbEmpty: { backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  statusText: { ...typography.caption },
  statusMuted: { ...typography.caption, color: colors.ink400, marginTop: 2 },
  statusDone: { color: colors.success, fontFamily: fonts.semibold },
  statusRejected: { ...typography.caption, color: colors.error, fontFamily: fonts.semibold, marginTop: 2 },
  rejectionNote: { ...typography.caption, color: colors.ink400, marginTop: 2 },
  pressedScale: { transform: [{ scale: 0.97 }] },
})
