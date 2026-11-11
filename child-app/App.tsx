import React, { useEffect, useState } from 'react';
import { StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './src/components';
import { Native, type StoredCredentials } from './src/native';
import Consent from './src/screens/Consent';
import Home from './src/screens/Home';
import Pair from './src/screens/Pair';
import { s } from './src/theme';

type Screen = 'loading' | 'consent' | 'pair' | 'home' | 'disconnected';

function Root() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [creds, setCreds] = useState<StoredCredentials | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    Native.getCredentials()
      .then((c) => {
        setCreds(c);
        setScreen(c ? 'home' : 'consent');
      })
      .catch(() => setScreen('consent'));
  }, []);

  const disconnected = async (why: 'revoked' | 'unpaired') => {
    await Native.clearCredentials();
    setCreds(null);
    setReason(
      why === 'revoked'
        ? 'Your parent has turned off monitoring for this phone. Nothing is being shared any more.'
        : 'This phone is disconnected. Nothing is being shared any more.',
    );
    setScreen('disconnected');
  };

  switch (screen) {
    case 'loading':
      return null;
    case 'consent':
      return <Consent onAccept={() => setScreen('pair')} />;
    case 'pair':
      return (
        <Pair
          onBack={() => setScreen('consent')}
          onPaired={(c) => {
            setCreds(c);
            setScreen('home');
          }}
        />
      );
    case 'home':
      return creds ? <Home creds={creds} onDisconnected={(w) => void disconnected(w)} /> : null;
    case 'disconnected':
      return (
        <View style={[s.scroll, { gap: 16 }]}>
          <Text style={s.h1}>Monitoring is off</Text>
          <Text style={s.body}>{reason}</Text>
          <Text style={s.muted}>You can uninstall this app, or connect again with a new code from your parent.</Text>
          <Button title="Connect again" kind="primary" onPress={() => setScreen('consent')} />
        </View>
      );
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.screen}>
        <Root />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
