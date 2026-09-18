import { ActivityIndicator, Keyboard, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import usePlaceAutocomplete from '../hooks/usePlaceAutocomplete';
import { rf } from '../lib/responsive';

export default function PlaceAutocomplete({ visible, onSelect }) {
  const search = usePlaceAutocomplete(visible);
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Search place, street, or city..."
          accessibilityLabel="Search for a Philippine location"
          value={search.query}
          onChangeText={search.changeQuery}
          onSubmitEditing={search.retry}
          returnKeyType="search"
        />
        {search.query ? (
          <TouchableOpacity style={styles.clear} accessibilityLabel="Clear location search" onPress={() => search.changeQuery('')}>
            <Text style={styles.clearText}>×</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.button}
          onPress={search.retry}
          disabled={search.searching || !search.configured || search.query.trim().length < 3}
        >
          {search.searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>Search</Text>}
        </TouchableOpacity>
      </View>
      {!search.configured && <Text style={styles.note}>Location search is not configured. You can still pin on the map.</Text>}
      {search.showResults && (
        <View style={styles.dropdown}>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {search.searching ? <Text style={styles.note}>Searching locations…</Text>
              : search.error ? <Text style={styles.note}>{search.error}</Text>
                : search.results.length === 0 ? <Text style={styles.note}>No matching locations found.</Text>
                  : search.results.map((item, index) => (
                    <TouchableOpacity
                      key={item.place_id || `${item.lat},${item.lon},${index}`}
                      style={styles.result}
                      onPress={() => {
                        search.selectResult(item);
                        Keyboard.dismiss();
                        onSelect(item);
                      }}
                    >
                      <Text style={styles.resultText} numberOfLines={3}>{item.display_name}</Text>
                    </TouchableOpacity>
                  ))}
          </ScrollView>
        </View>
      )}
      <Text
        style={styles.attribution}
        accessibilityRole="link"
        onPress={() => { Linking.openURL('https://www.geoapify.com/').catch(() => {}); }}
      >Powered by Geoapify</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 8 },
  input: { flex: 1, minWidth: 0, paddingHorizontal: 4, paddingVertical: 10, fontSize: rf(14), color: '#222', textAlignVertical: 'center' },
  clear: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: '#666', fontSize: rf(18) },
  button: { backgroundColor: '#1E4E09', minHeight: 38, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, marginLeft: 4, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: rf(13) },
  dropdown: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#ddd', marginTop: 4, overflow: 'hidden' },
  list: { maxHeight: 180 },
  result: { minHeight: 44, padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  resultText: { fontSize: rf(13), color: '#333' },
  note: { padding: 10, fontSize: rf(12), color: '#666' },
  attribution: { fontSize: rf(11), color: '#1E4E09', textAlign: 'right', marginTop: 4, textDecorationLine: 'underline' },
});
