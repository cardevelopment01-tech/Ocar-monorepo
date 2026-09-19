const React = require('react')
const { View, Text } = require('react-native')

module.exports = {
  __esModule: true,
  default: {
    View: View,
    Text: Text,
  },
  View: View,
  Text: Text,
  FadeIn: {
    duration: (ms) => ({ duration: ms }),
  },
  FadeOut: {
    duration: (ms) => ({ duration: ms }),
  },
  Animated: {
    View: View,
    Text: Text,
  },
  useSharedValue: (initial) => ({ value: initial }),
  useAnimatedStyle: (fn) => fn(),
  withRepeat: (toValue) => toValue,
  withSequence: (...values) => values[0],
  withTiming: (toValue) => toValue,
}
