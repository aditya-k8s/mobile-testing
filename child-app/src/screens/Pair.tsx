import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { normaliseServerUrl, pair } from '../api';
import { Button } from '../components';
import { Native, type StoredCredentials } from '../native';
import { DEFAULT_SERVER_URL, s } from '../theme';

export default function Pair({ onPaired, onBack }: { onPaired: (c: StoredCredentials) => void; onBack: () => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER_URL);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Native.getDeviceInfo().then((i) => setName((n) => n || i.model)).catch(() => undefined);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await Native.getDeviceInfo();
      const serverUrl = normaliseServerUrl(server);
      const r = await pair(serverUrl, {
        code,
        device_name: name.trim() || info.model,
        model: info.model,
        platform: 'android',
        os_version: info.osVersion,
        app_version: '1.0',
        timezone: info.timezone,
        consent_accepted: true,
      });
      await Native.saveCredentials(serverUrl, r.device_token, r.device_id, r.parent_name);
      onPaired({ serverUrl, deviceToken: r.device_token, deviceId: r.device_id, parentName: r.parent_name });
    } catch (e) {
      setError(e instanceof TypeError ? 'Could not reach the server. Check the address and your connection.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Connect to your parent</Text>
      <Text style={s.body}>Ask your parent for the pairing code shown in their Family Monitor dashboard.</Text>

      <Text style={s.label}>Pairing code</Text>
      <TextInput style={[s.input, { fontSize: 22, letterSpacing: 4 }]} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="ABCD-2345" maxLength={9} />

      <Text style={s.label}>Name for this phone</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} maxLength={80} />

      <Text style={s.label}>Server address</Text>
      <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />

      {error && <Text style={s.error}>{error}</Text>}
      <Button title="Connect" kind="primary" onPress={() => void submit()} busy={busy} disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 8} />
      <Button title="Back" onPress={onBack} />
    </ScrollView>
  );
}
