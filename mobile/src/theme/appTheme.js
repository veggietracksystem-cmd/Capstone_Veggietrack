// Shared design tokens.
export const colors = {
  // Screens use a white background; cards and grouped sections use `surface`.
  bgScreen: '#FFFFFF',
  surface: '#FAFAF7',
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
  // Form field labels.
  labelInk: '#3D4834',
  inkFaint: '#9AA290',
  // Placeholder colour shared by every text input.
  placeholder: '#9AA290',
  card: '#FFFFFF',
  border: '#E8E2D2',
  danger: '#B3261E',
  dangerSoft: '#FBE7E5',
  info: '#1D4ED8',
  infoSoft: '#E4EBFB',
  purple: '#6D28D9',
  purpleSoft: '#EEE7FB',
};

// Spacing scale for screen padding and gaps between cards and sections.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

// Control metrics: `minTouch` is the minimum tap target; `height` is the standard
// height for buttons, chips and filter tabs.
export const control = {
  minTouch: 44,
  height: 44,
  heightSm: 36,
  paddingH: 16,
  paddingHSm: 12,
};

export const radius = {
  card: 14,
  ctrl: 10,
  sheet: 22,
};

// Font-size scale; screens reference these via rf(fontSize.x).
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
  // Soft green-tinted card shadow (native and web).
  boxShadow: '0 6px 20px rgba(30, 78, 9, 0.12)',
};

// Compact action button for card and row actions. Variants only change colours:
// primary (solid), outline and danger.
export const actionBtn = {
  minHeight: 32,
  paddingVertical: 6,
  paddingHorizontal: 14,
  borderRadius: radius.ctrl,
  borderWidth: 1.4,
  alignItems: 'center',
  justifyContent: 'center',
};
export const actionBtnOutline = { backgroundColor: colors.card, borderColor: colors.leaf700 };
export const actionBtnPrimary = { backgroundColor: colors.leaf700, borderColor: colors.leaf700 };
export const actionBtnDanger = { backgroundColor: colors.card, borderColor: colors.danger };
export const actionBtnText = { fontFamily: fonts.bodySemiBold, fontSize: fontSize.sm, textAlign: 'center' };
