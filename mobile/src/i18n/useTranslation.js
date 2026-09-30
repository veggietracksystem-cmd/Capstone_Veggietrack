import { useLanguageContext } from './LanguageProvider';

export function useTranslation() {
  return useLanguageContext();
}
