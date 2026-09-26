import { Text as RNText, type TextProps } from 'react-native'

/** Text with the system font-size setting capped at 1.15x: the reference's fixed-size
 *  chips, tab labels and cards break apart at the OS maximum (1.3x+), so scale a little, not fully. */
export const FONT_CAP = 1.15
export const Text = (props: TextProps) => <RNText maxFontSizeMultiplier={FONT_CAP} {...props} />
