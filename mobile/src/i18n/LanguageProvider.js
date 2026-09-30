import {
  createContext, useContext, useState, useEffect, useCallback, useMemo,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './translations/en.json';
import tl from './translations/tl.json';
import { setCurrentLanguage, trc } from './translate';

const LANGUAGE_KEY = 'app_language';
const TRANSLATIONS = { en, tl };

const LanguageContext = createContext(null);

function resolve(dict, path) {
  return path.split('.').reduce(
    (acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined),
    dict
  );
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  // Synchronize before children render alerts through the non-hook translator.
  setCurrentLanguage(language);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
        if (saved === 'en' || saved === 'tl') setLanguageState(saved);
      } catch (err) {
        console.warn('[Language] Failed to restore saved language:', err);
      }
    })();
  }, []);

  const setLanguage = useCallback((lang) => {
    if (lang !== 'en' && lang !== 'tl') return;
    setLanguageState(lang);
    AsyncStorage.setItem(LANGUAGE_KEY, lang).catch((err) => {
      console.warn('[Language] Failed to persist language:', err);
    });
  }, []);

  const t = useCallback((key, vars) => {
    const value = resolve(TRANSLATIONS[language], key);
    const fallback = resolve(TRANSLATIONS.en, key);
    const str = typeof value === 'string' ? value : (typeof fallback === 'string' ? fallback : key);
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    ));
  }, [language]);

  const tRaw = useCallback((key) => {
    const value = resolve(TRANSLATIONS[language], key);
    return value !== undefined ? value : resolve(TRANSLATIONS.en, key);
  }, [language]);

  const tc = useCallback((key, count, vars) => trc(key, count, vars), [language]);

  const value = useMemo(() => ({ language, setLanguage, t, tc, tRaw }), [language, setLanguage, t, tc, tRaw]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguageContext() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguageContext must be used inside a <LanguageProvider>');
  return ctx;
}
