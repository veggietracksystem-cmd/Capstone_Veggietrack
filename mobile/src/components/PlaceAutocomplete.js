import { ActivityIndicator, Keyboard, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import TextInput from './AppTextInput';
import usePlaceAutocomplete from '../hooks/usePlaceAutocomplete';
import { rf } from '../lib/responsive';
import { colors, radius, actionBtn, actionBtnPrimary, actionBtnText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

export default function PlaceAutocomplete({ visible, onSelect }) {
  const { t } = useTranslation();
  const search = usePlaceAutocomplete(visible);
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.field}>
        <TextInput
          style={styles.input}
          placeholder={t('cmp.searchPh')} placeholderTextColor={colors.placeholder}
          accessibilityLabel={t('cmp.searchA11y')}
          value={search.query}
          onChangeText={search.changeQuery}
          onSubmitEditing={search.retry}
          returnKeyType="search"
        />
        {search.query ? (
          <TouchableOpacity style={styles.clear} accessibilityLabel={t('cmp.clearSearch')} onPress={() => search.changeQuery('')}>
            <Text style={styles.clearText}>×</Text>
          </TouchableOpacity>
        ) : null}
        </View>
        <TouchableOpacity
          style={[styles.button, (search.searching || !search.configured || search.query.trim().length < 3) && styles.buttonDisabled]}
          onPress={search.retry}
          disabled={search.searching || !search.configured || search.query.trim().length < 3}
        >
          {search.searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>{t('cmp.search')}</Text>}
        </TouchableOpacity>
      </View>
      <Text
        style={styles.attribution}
        accessibilityRole="link"
        onPress={() => { Linking.openURL('https://www.geoapify.com/').catch(() => {}); }}
      >{t('cmp.poweredBy')}</Text>
      {!search.configured && <Text style={styles.note}>{t('cmp.searchUnavailable')}</Text>}
      {search.showResults && (
        <View style={styles.dropdown}>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {search.searching ? <Text style={styles.note}>{t('cmp.searching')}</Text>
              : search.error ? <Text style={styles.note}>{/limit reached/.test(search.error) ? t('misc.searchLimit') : t('misc.searchFail')}</Text>
                : search.results.length === 0 ? <Text style={styles.note}>{t('cmp.noMatch')}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  // 16px side margins; the search row, attribution and results stack with even gaps before the map.
  container: { paddingHorizontal: 16, paddingTop: 12, marginBottom: 12 },
  // One row: wide field (with the clear x inside it) + compact Search button, 10px apart, vertically centered.
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  field: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', minHeight: 44, backgroundColor: colors.card, borderWidth: 1.4, borderColor: colors.border, borderRadius: radius.ctrl, paddingLeft: 12, paddingRight: 4 },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: rf(14), color: colors.ink, textAlignVertical: 'center' },
  clear: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: colors.inkSoft, fontSize: rf(18) },
  button: { ...actionBtn, ...actionBtnPrimary, flexShrink: 0 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...actionBtnText, color: '#fff' },
  dropdown: { backgroundColor: colors.card, borderRadius: radius.ctrl, borderWidth: 1, borderColor: colors.border, marginTop: 8, overflow: 'hidden' },
  list: { maxHeight: 180 },
  result: { minHeight: 44, padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultText: { fontSize: rf(13), color: colors.ink },
  note: { padding: 10, fontSize: rf(12), color: colors.inkSoft },
  // Small and subtle, left-aligned right under the search row.
  attribution: { alignSelf: 'flex-start', fontSize: 10, color: colors.inkFaint, marginTop: 6, textDecorationLine: 'underline' },
});
