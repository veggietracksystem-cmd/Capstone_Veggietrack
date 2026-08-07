// Shared design tokens for the whole app, matching the approved Farmer
// module mockup (leaf/gold/soil palette, Baloo 2 headings + Inter body).
// Applied system-wide so every role's UI shares one visual language.
export const colors = {
  bgScreen: '#FDFDFD',
  leaf900: '#1F4A27',
  leaf700: '#1E4E09',
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
  heading: 'Poppins_600SemiBold',
  headingBold: 'Poppins_700Bold',
  headingMedium: 'Poppins_500Medium',
  body: 'Poppins_400Regular',
  bodyMedium: 'Poppins_500Medium',
  bodySemiBold: 'Poppins_600SemiBold',
  bodyBold: 'Poppins_700Bold',
};

export const shadowCard = {
  shadowColor: '#2B2620',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.06,
  shadowRadius: 16,
  elevation: 2,
};
