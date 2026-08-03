import { useLanguageContext } from './LanguageProvider';

// Convenience hook used throughout the app: const { t, language, setLanguage } = useTranslation();
export function useTranslation() {
  return useLanguageContext();
}
