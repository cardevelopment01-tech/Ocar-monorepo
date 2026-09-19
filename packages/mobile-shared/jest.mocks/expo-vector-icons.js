const React = require('react')
const { Text } = require('react-native')

// Create a simple mock for vector icons
const IconComponent = React.forwardRef((props, ref) => {
  return React.createElement(Text, { ...props, ref }, '●')
})

module.exports = {
  __esModule: true,
  Feather: IconComponent,
}
