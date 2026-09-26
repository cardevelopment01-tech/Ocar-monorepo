import { Text as RNText, type TextProps } from 'react-native'

/** Text with the system font-size setting capped at 1.15x: fixed-size chips, headers and cards break apart at
 *  the OS maximum (1.3x+), so text scales a little, not fully. Used across both apps. */
export const FONT_CAP = 1.15
export const Text = (props: TextProps) => <RNText maxFontSizeMultiplier={FONT_CAP} {...props} />
