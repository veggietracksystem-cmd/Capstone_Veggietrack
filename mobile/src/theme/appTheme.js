// Shared design tokens for the whole app. These are the implementation-safe
// parts of the approved redesign: the same palette can be used by every role
// without changing any authentication, inventory, delivery, or offline flow.
export const colors = {
  // Main screen background is pure white; cards, list groups and grouped
  // sections sit on `surface`, a very light off-white, so they separate
  // from the page without heavy shadows. Inputs and controls stay `card` white.
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
  // Form field labels: darker than inkSoft so they read clearly, lighter than ink so they stay below titles.
  labelInk: '#3D4834',
  inkFaint: '#9AA290',
  // One light-grey placeholder colour for every text input in the app, so a
  // hint never reads as if the user already typed something. Referenced by
  // AuthInput/PasswordInput and every screen-level TextInput.
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

// One spacing scale for screen padding, gaps between cards, and the space
// between a section title and its content. Screens should use these instead of
// ad hoc numbers so margins stay even from screen to screen.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

// Shared control metrics. `minTouch` is the smallest comfortable tap target;
// `height` is the standard height for buttons, chips and filter tabs so
// adjacent controls line up and a tab never changes size when selected.
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

// One compact action-button design for card/row actions (Edit, View Details,
// Set Default, Delete, Track Order, ...). Same height, padding, radius, border
// and type everywhere; width stays flexible (set by the label / layout).
// Variants only change colors: primary (solid dark green), outline (secondary,
// outlined green) and danger (outlined red, for destructive actions).
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
