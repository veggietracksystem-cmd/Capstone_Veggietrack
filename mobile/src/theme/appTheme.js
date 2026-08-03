// Shared design tokens for the whole app, matching the approved Farmer
// module mockup (leaf/gold/soil palette, Baloo 2 headings + Inter body).
// Applied system-wide so every role's UI shares one visual language.
export const colors = {
  bgScreen: '#F7F4EC',
  leaf900: '#1F4A27',
  leaf700: '#2F6B3A',
  leaf500: '#3F8A4C',
  leaf100: '#E1EEDD',
  leaf50: '#EEF5EA',
  gold700: '#B9791E',
  gold500: '#E3A23C',
  gold100: '#FBEBCE',
  soil800: '#4A3221',
  soil600: '#7A5233',
  soil300: '#C9B79E',
  ink: '#2B2620',
  inkSoft: '#6B6255',
  inkFaint: '#9A9182',
  card: '#FFFFFF',
  border: '#E7DFCE',
  danger: '#B94A3B',
};

export const radius = {
  card: 18,
  ctrl: 12,
};

export const fonts = {
  heading: 'Baloo2_600SemiBold',
  headingBold: 'Baloo2_700Bold',
  headingMedium: 'Baloo2_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
};

export const shadowCard = {
  shadowColor: '#2B2620',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.06,
  shadowRadius: 16,
  elevation: 2,
};
