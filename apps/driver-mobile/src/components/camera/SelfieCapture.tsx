import { useRef, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { getInfoAsync } from 'expo-file-system/legacy'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import type { PickedFile } from '@/features/onboarding/api'
import { OvalOverlay } from './OvalOverlay'

/**
 * Full-screen front-camera selfie capture with the oval guide and a retake/confirm preview.
 * Used to replace the profile photo after onboarding (Documents screen and Profile avatar).
 * Live camera only: no gallery, so a re-upload can't be an old photo or a screenshot.
 * (onboarding/selfie.tsx has its own inline copy tied to the onboarding shell.)
 */
export function SelfieCapture({ visible, onCancel, onConfirm }: {
  visible: boolean
  onCancel: () => void
  onConfirm: (file: PickedFile) => void
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [photo, setPhoto] = useState<PickedFile | null>(null)

  function close() {
    setPhoto(null)
    setReady(false)
    onCancel()
  }

  async function capture() {
    if (!cameraRef.current || capturing) return
    setCapturing(true)
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.75 })
      if (!shot) return
      const info = await getInfoAsync(shot.uri)
      setPhoto({ uri: shot.uri, mimeType: 'image/jpeg', fileSize: info.exists ? (info.size ?? 0) : 0, width: shot.width, height: shot.height })
    } finally {
      setCapturing(false)
    }
  }

  function confirm() {
    if (!photo) return
    const file = photo
    setPhoto(null)
    setReady(false)
    onConfirm(file)
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.screen}>
        {!permission?.granted ? (
          <View style={styles.center}>
            <Feather name="camera" size={32} color={colors.inkInverse} />
            <Text style={styles.msg}>
              {permission && !permission.canAskAgain
                ? "Camera access is off. Enable it for Ocar Driver in your phone's Settings, then try again."
                : 'Ocar needs your camera to take your profile photo.'}
            </Text>
            {permission?.canAskAgain !== false ? <Button label="Allow camera" onPress={() => void requestPermission()} /> : null}
          </View>
        ) : photo ? (
          <View style={styles.center}>
            <Image source={{ uri: photo.uri }} style={styles.preview} />
            <Text style={styles.msg}>Is your face clear and well lit? Riders will see this photo.</Text>
            <View style={styles.actions}>
              <Button label="Use this photo" onPress={confirm} />
              <Button label="Retake" variant="ghost" icon="refresh-cw" onPress={() => setPhoto(null)} />
            </View>
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" onCameraReady={() => setReady(true)} />
            {!ready ? <View style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color={colors.inkInverse} size="large" /></View> : null}
            <OvalOverlay screenWidth={width} screenHeight={height} />
            <View style={styles.chipTop} pointerEvents="none">
              <Text style={styles.chipText}>Face the light · Remove cap and glasses · Look straight</Text>
            </View>
            <View style={[styles.shutterRow, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.lg }]}>
              <Pressable onPress={() => void capture()} disabled={!ready || capturing} style={styles.shutterBtn} accessibilityLabel="Capture selfie">
                <View style={styles.shutterRing} />
                <View style={styles.shutterDisc} />
              </Pressable>
            </View>
          </>
        )}
        <Pressable onPress={close} style={[styles.closeBtn, { top: insets.top + spacing.sm }]} accessibilityLabel="Close" hitSlop={8}>
          <Feather name="x" size={18} color={colors.inkInverse} />
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  msg: { ...typography.body, color: colors.inkInverse, textAlign: 'center' },
  preview: { width: 240, height: 240, borderRadius: radii['2xl'] },
  actions: { alignSelf: 'stretch', gap: spacing.xs },
  closeBtn: { position: 'absolute', left: spacing.lg, width: 44, height: 44, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  chipTop: { position: 'absolute', top: 96, left: spacing.lg, right: spacing.lg, alignItems: 'center', zIndex: 15 },
  chipText: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.bold, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.full, overflow: 'hidden', textAlign: 'center' },
  shutterRow: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#000000', paddingTop: spacing.lg, alignItems: 'center' },
  shutterBtn: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  shutterDisc: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.inkInverse },
})
