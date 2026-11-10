// Single source of truth for brand colours. Change here and the whole UI follows.
export const theme = {
  primary: '#20B9D4',
  primaryLight: '#47C8DD',
  primaryTint: '#E4F6FA',
  text: '#171717',
  action: '#B94B0D',
  actionTint: '#FDEFE6',
  bg: '#F7F5F0',
  card: '#FFFFFF',
  border: '#E8E1D7',
  muted: '#746F69',
  success: '#198754',
  warning: '#E8A23A',
  error: '#DC3545',
};

export function applyTheme(t = theme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(t)) {
    root.style.setProperty(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  }
}
