const React = require('react')
const { View } = require('react-native')

// LinearGradient is just a View for testing purposes
module.exports = {
  __esModule: true,
  LinearGradient: React.forwardRef((props, ref) => {
    const { children, ...rest } = props
    return React.createElement(View, { ...rest, ref }, children)
  }),
}
