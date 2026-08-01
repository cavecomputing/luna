import a64 from '../../../assets/LunaChatAvatar/luna-chat-avatar-round-64.png'
import a128 from '../../../assets/LunaChatAvatar/luna-chat-avatar-round-128.png'
import a256 from '../../../assets/LunaChatAvatar/luna-chat-avatar-round-256.png'
import styles from './avatar.module.css'

/**
 * Luna's face. The round artwork carries its own circular edge and transparent
 * corners, so it sits on any bubble colour in either theme.
 *
 * Candidates are described by width rather than density, so one list serves
 * every call site: the browser multiplies `sizes` by the screen's DPR and takes
 * the smallest candidate that clears it. A 28px avatar on a Retina Mac needs
 * 56, so it loads the 64.
 *
 * The 32px file is deliberately absent. Vite inlines anything under 4 KB as a
 * base64 data URI, and the comma in `data:image/png;base64,…` would split the
 * srcSet into garbage candidates.
 */
const sources = `${a64} 64w, ${a128} 128w, ${a256} 256w`

type Props = {
  size?: number
  /** Empty when nearby text already names her, so she isn't announced twice. */
  alt?: string
}

export function Avatar({ size = 28, alt = 'Luna' }: Props): React.JSX.Element {
  return (
    <img
      className={styles.avatar}
      src={a128}
      srcSet={sources}
      sizes={`${String(size)}px`}
      alt={alt}
      width={size}
      height={size}
    />
  )
}
