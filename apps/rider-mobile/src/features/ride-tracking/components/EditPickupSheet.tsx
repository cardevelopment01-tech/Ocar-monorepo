import { useCallback, useRef, useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import MapView, { Circle, Marker, Polyline, type MarkerDragStartEndEvent } from 'react-native-maps'
import { Feather } from '@expo/vector-icons'
import { Button, PinGlyph, font, h, haversineMetres } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { OCAR_MAP_PROPS } from '@ocar/mobile-shared'
import { fetchReverseGeocode } from '@/features/booking/api'
import { clampToRadius } from '../clampToRadius'

// Mirrors api/src/constants/limits.ts's PICKUP_EDIT_RADIUS_METRES. This copy
// is UX feedback only (the vignette, the boundary pill) -- the server
// re-validates with its own constant and never trusts a client-only radius.
const PICKUP_EDIT_RADIUS_METRES = 150
// ~150m span comfortably visible with room to drag to the edge.
const EDIT_LAT_DELTA = 0.0045

export type EditPickupSheetProps = {
  visible: boolean
  originLat: number
  originLng: number
  originAddress: string | null
  userPos: [number, number] | null
  driverAssigned: boolean
  confirming: boolean
  error: string | null
  onClose: () => void
  onConfirm: (pickup: { lat: number; lng: number; address: string | null }) => void
}

export function EditPickupSheet({
  visible, originLat, originLng, originAddress, userPos, driverAssigned, confirming, error, onClose, onConfirm,
}: EditPickupSheetProps) {
  const origin = useRef<[number, number]>([originLat, originLng])
  const [pinPos, setPinPos] = useState<[number, number]>([originLat, originLng])
  const [address, setAddress] = useState<string | null>(originAddress)
  const [geocoding, setGeocoding] = useState(false)
  const [proximity, setProximity] = useState(0)
  const [atBoundary, setAtBoundary] = useState(false)
  const geocodeSeq = useRef(0)

  const resetOnOpen = useCallback(() => {
    origin.current = [originLat, originLng]
    setPinPos([originLat, originLng])
    setAddress(originAddress)
    setProximity(0)
    setAtBoundary(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function handleDrag(e: MarkerDragStartEndEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate
    const dist = haversineMetres(origin.current, [latitude, longitude])
    // Quantised to 5% steps: native drag events fire continuously and each setState re-rendered the whole sheet.
    const next = Math.round(Math.min(1, dist / PICKUP_EDIT_RADIUS_METRES) * 20) / 20
    setProximity((prev) => (prev === next ? prev : next))
  }

  function handleDragEnd(e: MarkerDragStartEndEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate
    const clamped = clampToRadius(origin.current, [latitude, longitude], PICKUP_EDIT_RADIUS_METRES)
    const wasClamped = clamped[0] !== latitude || clamped[1] !== longitude
    setPinPos(clamped)
    setProximity(wasClamped ? 1 : haversineMetres(origin.current, clamped) / PICKUP_EDIT_RADIUS_METRES)
    setAtBoundary(wasClamped)
    if (wasClamped) setTimeout(() => setAtBoundary(false), 2000)

    const seq = ++geocodeSeq.current
    setGeocoding(true)
    fetchReverseGeocode(clamped[0], clamped[1])
      .then((r) => { if (geocodeSeq.current === seq) setAddress(r.address) })
      .catch(() => {})
      .finally(() => { if (geocodeSeq.current === seq) setGeocoding(false) })
  }

  const distanceToUser = userPos ? Math.round(haversineMetres(userPos, pinPos)) : null
  const edgeColor = proximity >= 0.85 ? h.gold : h.teal

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={resetOnOpen}>
      <View style={styles.screen}>
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={{ latitude: originLat, longitude: originLng, latitudeDelta: EDIT_LAT_DELTA, longitudeDelta: EDIT_LAT_DELTA }}
          {...OCAR_MAP_PROPS}
        >
          {/* No drawn boundary at rest -- the tight zoom itself communicates the
              allowed area. A soft ambient fill/stroke builds only as the pin
              nears the true edge (see docs/designs/2026-09-27-pickup-pin-edit-plan.md). */}
          <Circle
            center={{ latitude: origin.current[0], longitude: origin.current[1] }}
            radius={PICKUP_EDIT_RADIUS_METRES}
            fillColor={`${edgeColor}${Math.round(proximity * proximity * 40).toString(16).padStart(2, '0')}`}
            strokeColor={edgeColor}
            strokeWidth={proximity > 0.05 ? 2 : 0}
          />

          {userPos ? (
            <>
              <Polyline
                coordinates={[{ latitude: userPos[0], longitude: userPos[1] }, { latitude: pinPos[0], longitude: pinPos[1] }]}
                strokeColor={h.teal}
                strokeWidth={2}
                lineDashPattern={[1, 8]}
              />
              <Marker coordinate={{ latitude: userPos[0], longitude: userPos[1] }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.userDot} />
              </Marker>
            </>
          ) : null}

          <Marker
            coordinate={{ latitude: pinPos[0], longitude: pinPos[1] }}
            anchor={{ x: 0.5, y: 1 }}
            draggable
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            tracksViewChanges={false}
          >
            <PinGlyph variant="pickup" />
          </Marker>
        </MapView>

        <View style={styles.header}>
          <IconButton icon="arrow-left" label="Close" onPress={onClose} />
          <View style={styles.headerPill}>
            <Text style={styles.headerTitle}>Edit pickup</Text>
          </View>
        </View>

        {atBoundary ? (
          <View style={styles.boundaryPill}>
            <Text style={styles.boundaryText}>Pickup can only move within this zone</Text>
          </View>
        ) : null}

        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Confirm your pickup point</Text>
          <View style={styles.addressRow}>
            <View style={styles.addressIcon}>
              <Feather name="map-pin" size={16} color={h.tealText} />
            </View>
            {address ? (
              <Text style={styles.address}>{address}</Text>
            ) : (
              <View style={styles.addressSkeleton} />
            )}
          </View>
          <Text style={styles.hint}>
            {distanceToUser != null ? `${distanceToUser} m from your live location · ` : ''}
            Drag the pin to fine-tune.
          </Text>
          {driverAssigned ? <Text style={styles.hint}>Your driver will be notified of the update.</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={{ height: 10 }} />
          <Button
            variant="cta"
            label="Confirm pickup"
            loading={confirming || geocoding}
            onPress={() => onConfirm({ lat: pinPos[0], lng: pinPos[1], address })}
          />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 54 },
  headerPill: { height: 44, justifyContent: 'center', backgroundColor: h.surface, borderRadius: 22, paddingHorizontal: 18, boxShadow: '0 4px 14px rgba(20,23,26,0.14)' },
  headerTitle: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  boundaryPill: { position: 'absolute', top: 118, alignSelf: 'center', backgroundColor: h.goldWash, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  boundaryText: { fontFamily: font.sb, fontSize: 12.5, color: h.goldInk },
  userDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: h.teal, borderWidth: 2, borderColor: '#FFFFFF' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 30, gap: 6, boxShadow: '0 -12px 32px rgba(20,23,26,0.14)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 12 },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory, marginBottom: 6 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  addressIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  address: { fontFamily: font.b, fontSize: 15, lineHeight: 21, color: h.ivory, flex: 1, paddingTop: 5 },
  addressSkeleton: { flex: 1, height: 16, borderRadius: 4, backgroundColor: h.chip, marginTop: 8 },
  hint: { fontFamily: font.m, fontSize: 13, lineHeight: 19, color: h.muted, marginLeft: 44 },
  error: { fontFamily: font.sb, fontSize: 13, color: h.danger, marginTop: 4 },
})
