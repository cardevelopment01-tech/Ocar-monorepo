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
}
