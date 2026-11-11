import { StyleSheet } from 'react-native';

export const DEFAULT_SERVER_URL = 'http://20.68.130.169:8001'; // your server (nginx on WEB_PORT 8001)

export const colours = {
  bg: '#f5f6f4',
  surface: '#ffffff',
  border: '#e2e3df',
  text: '#0b0b0b',
  secondary: '#52514e',
  muted: '#6b6a66',
  accent: '#2a78d6',
  good: '#1f7a3d',
  goodBg: '#e3f3e8',
  warn: '#8a5a00',
  warnBg: '#fff4dc',
  live: '#b42318',
  liveBg: '#fde8e6',
};

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.bg },
  scroll: { padding: 16, gap: 12 },
  h1: { fontSize: 24, fontWeight: '700', color: colours.text, marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: '600', color: colours.text, marginBottom: 8 },
  body: { fontSize: 15, color: colours.text, lineHeight: 21 },
  muted: { fontSize: 13, color: colours.muted, lineHeight: 18 },
  card: { backgroundColor: colours.surface, borderRadius: 12, borderWidth: 1, borderColor: colours.border, padding: 16 },
  bullet: { fontSize: 15, color: colours.text, lineHeight: 22, marginLeft: 4 },
  input: { borderWidth: 1, borderColor: colours.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colours.text, backgroundColor: colours.surface, marginBottom: 12 },
  label: { fontSize: 13, color: colours.secondary, marginBottom: 4 },
  btn: { borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface },
  btnPrimary: { backgroundColor: colours.accent, borderColor: colours.accent },
  btnDanger: { backgroundColor: colours.live, borderColor: colours.live },
  btnText: { fontSize: 16, fontWeight: '600', color: colours.text },
  btnTextLight: { color: '#ffffff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { color: colours.live, marginBottom: 8 },
});
