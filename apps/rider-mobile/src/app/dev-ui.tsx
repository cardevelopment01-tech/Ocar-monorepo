// THROWAWAY: eyeball the redesign primitives on device. Open via the deep link ocar-rider://dev-ui. Delete before release.
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Button, Text, font, h } from '@ocar/mobile-shared'
import { Chip, ExpandableSection, GroupedList, IconButton, ListRow, ReceiptRow, RouteTimeline, SegmentedControl, StarRating, TicketBanner } from '@/components/ui'

export default function DevUi() {
  const [stars, setStars] = useState(4)
  const [tip, setTip] = useState('none')
  const [coupon, setCoupon] = useState(true)
  return (
    <ScrollView style={{ flex: 1, backgroundColor: h.canvas }} contentContainerStyle={{ padding: 18, paddingTop: 56, paddingBottom: 80, gap: 18 }}>
      <Text style={{ fontFamily: font.xb, fontSize: 28, color: h.ivory }}>Dev UI</Text>
      <Text style={{ fontFamily: font.xb, fontSize: 36, color: h.ivory, fontVariant: ['tabular-nums'] }}>₹1,240</Text>
      <Button variant="cta" label="See rides from ₹1,240" />
      <Button variant="cta" label="Disabled" disabled />
      <Button variant="cta" label="Loading" loading />
      <Button variant="soft" label="Soft button" icon="phone" />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <IconButton icon="arrow-left" label="Back" />
        <Chip label="Best fare" tone="gold" />
        <Chip label="Paid" icon="check" />
        <Chip label="4 min" tone="neutral" />
      </View>
      <GroupedList>
        <ListRow icon="map-pin" title="Saved places" subtitle="Home, Work" onPress={() => {}} />
        <ListRow icon="bell" title="Notifications" onPress={() => {}} />
        <ListRow icon="trash-2" title="Delete account" danger onPress={() => {}} />
      </GroupedList>
      <View style={{ backgroundColor: '#fff', borderRadius: 22, padding: 16 }}>
        <ExpandableSection header={<Text style={{ fontFamily: font.sb, fontSize: 15, color: h.ivory }}>Trip details</Text>}>
          <RouteTimeline pickup="Patia, Bhubaneswar" drop="Cuttack Bus Stand" stops={['Kalinga Stadium']} onAddStop={() => {}} />
        </ExpandableSection>
      </View>
      {coupon ? <TicketBanner title="OCAR50 applied" subtitle="You save ₹50" onRemove={() => setCoupon(false)} /> : <Button variant="soft" label="Apply coupon" onPress={() => setCoupon(true)} />}
      <View style={{ backgroundColor: '#fff', borderRadius: 22, padding: 16 }}>
        <ReceiptRow label="Base fare" detail="12 km" amount="₹840" />
        <ReceiptRow label="Total" amount="₹1,240" strong />
      </View>
      <StarRating value={stars} onChange={setStars} />
      <SegmentedControl value={tip} onChange={setTip} options={[{ value: 'none', label: 'No tip' }, { value: '20', label: '₹20' }, { value: '50', label: '₹50' }]} />
    </ScrollView>
  )
}
