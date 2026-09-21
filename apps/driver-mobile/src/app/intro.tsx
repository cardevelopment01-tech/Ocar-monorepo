import { useRouter } from 'expo-router'
import { IntroCarousel, type IntroPage } from '@ocar/mobile-shared'
import { useOnboardingIntroStore } from '@/store/useOnboardingIntroStore'
import introPage1 from '../../assets/onboarding/page-1.png'
import introPage2 from '../../assets/onboarding/page-2.png'
import introPage3 from '../../assets/onboarding/page-3.png'

const PAGES: IntroPage[] = [
  {
    image: introPage1,
    title: 'Drive on your own time',
    subtitle: 'Go online whenever works for you and start earning.',
  },
  {
    image: introPage2,
    title: 'Know every ride before it starts',
    subtitle: 'See your pickup, drop, and fare before you accept.',
  },
  {
    image: introPage3,
    title: 'Get paid, instantly',
    subtitle: 'Your earnings land in your wallet the moment a trip ends.',
  },
]

export default function IntroScreen() {
  const router = useRouter()
  const markIntroSeen = useOnboardingIntroStore((s) => s.markIntroSeen)

  function handleDone() {
    markIntroSeen()
    router.replace('/(auth)/phone')
  }

  return <IntroCarousel pages={PAGES} onDone={handleDone} />
}
