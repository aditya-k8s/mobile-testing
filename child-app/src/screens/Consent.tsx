import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Bullets, Button } from '../components';
import { colours, s } from '../theme';

export const SHARED = [
  'Which apps you use and for how long each day',
  'The app you are using right now',
  'Whether this phone is online',
  'Your screen, but only during a session you accept',
];

export const NOT_SHARED = [
  'Your messages, chats or emails',
  'What you type, your passwords or your browsing content',
  'Your camera, microphone or any sound',
  'Your location',
  'Screen recordings: live sharing is never saved',
];

export default function Consent({ onAccept }: { onAccept: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Text style={s.h1}>Before you connect</Text>
      <Text style={s.body}>
        Family Monitor lets your parent see how this phone is used. Please read this together with your parent.
      </Text>

      <View style={s.card}>
        <Text style={s.h2}>What your parent can see</Text>
        <Bullets items={SHARED} />
      </View>

      <View style={s.card}>
        <Text style={s.h2}>What is never shared</Text>
        <Bullets items={NOT_SHARED} />
      </View>

      <View style={s.card}>
        <Text style={s.h2}>Your controls</Text>
        <Bullets
          items={[
            'You choose whether to accept each screen-sharing request.',
            'A notification is always shown while your screen is shared.',
            'You can stop sharing at any time.',
            'You can see everything your parent sees in this app.',
            'You can disconnect this phone. Your parent will be told.',
          ]}
        />
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        onPress={() => setAgreed((a) => !a)}
        style={[s.row, { paddingVertical: 8 }]}
      >
        <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: colours.accent, backgroundColor: agreed ? colours.accent : 'transparent' }} />
        <Text style={[s.body, { flex: 1 }]}>I have read this and agree to connect this phone.</Text>
      </Pressable>
      <Button title="Continue" kind="primary" disabled={!agreed} onPress={onAccept} />
    </ScrollView>
  );
}
