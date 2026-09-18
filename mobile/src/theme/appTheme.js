// Shared design tokens for the whole app. These are the implementation-safe
// parts of the approved redesign: the same palette can be used by every role
// without changing any authentication, inventory, delivery, or offline flow.
export const colors = {
  bgScreen: '#FBF7EE',
  leaf900: '#123005',
  leaf700: '#1E4E09',
  leaf500: '#3C7A1E',
  leaf100: '#E7F0DD',
  leaf50: '#F2F7ED',
  gold700: '#B4740E',
  gold500: '#F2A93B',
  gold100: '#FBF0DA',
  soil800: '#24301C',
  soil600: '#6E7566',
  soil300: '#E8E2D2',
  ink: '#24301C',
  inkSoft: '#6E7566',
  inkFaint: '#9AA290',
  card: '#FFFFFF',
  border: '#E8E2D2',
  danger: '#B3261E',
  dangerSoft: '#FBE7E5',
  info: '#1D4ED8',
  infoSoft: '#E4EBFB',
  purple: '#6D28D9',
  purpleSoft: '#EEE7FB',
};

export const radius = {
  card: 14,
  ctrl: 10,
  sheet: 22,
};

// Single font-size scale for the whole app. Every screen should reference
// these tokens (via rf(fontSize.x)) instead of ad hoc numeric sizes, so
// headers/body/labels/buttons read consistently across every role.
export const fontSize = {
  xs: 11,
  sm: 12.5,
  md: 14,
  lg: 16,
  xl: 18,
  title: 20,
  h1: 26,
};

export const fonts = {
  heading: 'Poppins_600SemiBold',
  headingBold: 'Poppins_700Bold',
  headingMedium: 'Poppins_500Medium',
  body: 'Poppins_400Regular',
  bodyMedium: 'Poppins_500Medium',
  bodySemiBold: 'Poppins_600SemiBold',
  bodyBold: 'Poppins_700Bold',
};

export const shadowCard = {
  // Supported by current Expo/RN targets and maps to the redesign's soft,
  // green-tinted card shadow on native and web.
  boxShadow: '0 6px 20px rgba(30, 78, 9, 0.12)',
};
