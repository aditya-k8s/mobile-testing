import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colours, s } from './theme';

export function Button({ title, onPress, kind = 'default', disabled, busy }: {
  title: string;
  onPress: () => void;
  kind?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const light = kind !== 'default';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        kind === 'primary' && s.btnPrimary,
        kind === 'danger' && s.btnDanger,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {busy ? <ActivityIndicator color={light ? '#fff' : colours.text} /> : <Text style={[s.btnText, light && s.btnTextLight]}>{title}</Text>}
    </Pressable>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((t) => (
        <Text key={t} style={s.bullet}>{'•'} {t}</Text>
      ))}
    </View>
  );
}

export function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: ok ? colours.good : colours.warn }} />
      <View style={{ flex: 1 }}>
        <Text style={s.body}>{label}</Text>
        {detail ? <Text style={s.muted}>{detail}</Text> : null}
      </View>
    </View>
  );
}
