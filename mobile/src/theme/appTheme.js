import { rf } from '../lib/responsive';

export const colors = {
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
  labelInk: '#3D4834',
  inkFaint: '#9AA290',
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

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

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

// Text roles. Text with the same purpose uses the same role on every screen, so
// sizes and weights stay consistent across Farmer, Distributor, Retailer, Rider
// and the sign-in screens. Sizes are fontSize steps, scaled to the screen with rf.
export const typography = {
  screenTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.title) },     // ScreenHeader
  authTitle: { fontFamily: fonts.headingBold, fontSize: rf(fontSize.h1) },      // sign-in pages
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl) },       // page sections ("Current Tasks")
  modalTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl) },
  cardHeading: { fontFamily: fonts.heading, fontSize: rf(fontSize.lg) },        // heading inside a card
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg) },         // order/pickup id, product name
  listTitle: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md) },     // list row, tile or option title
  body: { fontFamily: fonts.body, fontSize: rf(fontSize.md) },
  meta: { fontFamily: fonts.body, fontSize: rf(fontSize.sm) },                  // secondary details, dates
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm) },         // form field label
  smallLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.xs) },            // label above a detail value
  statLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs) },
  statValue: { fontFamily: fonts.heading, fontSize: rf(fontSize.h1) },
  input: { fontFamily: fonts.body, fontSize: rf(fontSize.md) },
  buttonPrimary: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.lg) }, // main action of a screen or modal
  buttonBlock: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md) },   // full-width button inside a card
  buttonCompact: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm) }, // small card actions (actionBtn)
  chip: { fontFamily: fonts.body, fontSize: rf(fontSize.sm) },                  // selectable chip (date, reason)
  filter: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm) },        // filter tab or dropdown value
  badge: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs) },         // StatusBadge
  navLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs) },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm) },
  helper: { fontFamily: fonts.body, fontSize: rf(fontSize.sm) },                // hints, instructions, banners
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg) },
  emptyMessage: { fontFamily: fonts.body, fontSize: rf(fontSize.md) },
};

export const shadowCard = {
  boxShadow: '0 6px 20px rgba(30, 78, 9, 0.12)',
};

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
export const actionBtnText = { ...typography.buttonCompact, textAlign: 'center' };

export const dangerButton = {
  backgroundColor: colors.danger,
  minHeight: 48,
  paddingHorizontal: 28,
  paddingVertical: 13,
  borderRadius: radius.ctrl,
  alignItems: 'center',
  justifyContent: 'center',
};
export const dangerButtonText = { ...typography.buttonPrimary, color: '#fff', textAlign: 'center' };
