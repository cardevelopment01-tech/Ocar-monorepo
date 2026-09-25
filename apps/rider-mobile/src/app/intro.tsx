import { useRouter } from 'expo-router'
import { IntroCarousel, type IntroPage } from '@ocar/mobile-shared'
import { useOnboardingIntroStore } from '@/store/useOnboardingIntroStore'
import introPage1 from '../../assets/onboarding/page-1.webp'
import introPage2 from '../../assets/onboarding/page-2.webp'
import introPage3 from '../../assets/onboarding/page-3.webp'

const PAGES: IntroPage[] = [
  {
    image: introPage1,
    title: 'Your ride, minutes away',
    subtitle: 'Book in seconds and get matched with a nearby driver.',
  },
  {
    image: introPage2,
    title: 'Watch it come to you',
    subtitle: 'Track your driver in real time, right up to your door.',
  },
  {
    image: introPage3,
    title: 'Sit back and relax',
    subtitle: "Enjoy a comfortable ride to wherever you're headed.",
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
