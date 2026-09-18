/* ==========================================================================
   ONBOARDING (Landing / Login / Register / OTP / Pending Approval)
   PROTOTYPE ONLY — Proposed visual redesign.

   IMPORTANT — proposed vs existing:
   These screens exist today (LandingScreen.js, PhoneOtpScreen.js /
   RegisterScreen.js / ApplicationStatusScreen.js). The flow, fields, and
   validation shown here match the real implementation. What's PROPOSED is
   the visual restyle — applying the app's own `appTheme.js` design tokens
   (already defined in the codebase but currently unused by these screens)
   and adding a "Confirm Password" field, which does not exist today.
   ========================================================================== */

const REGISTER_ROLES = [
  { value: 'farmer', label: 'Farmer', locationLabel: 'Farm Location' },
  { value: 'retailer', label: 'Retailer', locationLabel: 'Store Location' },
  { value: 'rider', label: 'Rider (Delivery)' },
];

const AuthScreens = {

  'auth-landing': {
    tab: 'start', back: false, immersive: true,
    render() {
      return `
      <div class="landing-wrap">
        <div class="landing-hero">
          <div class="brand-logo">${ICON('leaf', 40)}</div>
          <h1 class="brand-name">VeggieTrack</h1>
          <p class="brand-tagline">Fresh produce, tracked from farm to store.</p>
        </div>
        <div class="landing-actions">
          <button class="btn btn-primary btn-block" data-nav="auth-login">Get Started</button>
          <div class="auth-footer-link">New here?<span class="auth-link" data-nav="auth-register">Create an account</span></div>
        </div>
      </div>
      `;
    }
  },

  'auth-login': {
    tab: 'start', back: true, immersive: true,
    render() {
      return `
      ${topBar('Sign In', { back: true })}
      <div class="auth-form-wrap">
        ${formGroup('Mobile Number', `<input class="input" type="tel" placeholder="9171234567" value="9171234567" />`, 'Philippine mobile number, e.g. 09171234567.')}
        ${formGroup('Password', `<input class="input" type="password" placeholder="••••••••" value="••••••••" />`)}
        <div class="auth-link-row"><span class="auth-link" data-action="noop">Forgot password?</span></div>
        <button class="btn btn-primary btn-block" data-action="demoLogin">Sign In</button>
        <div class="auth-footer-link">Don't have an account?<span class="auth-link" data-nav="auth-register">Create account</span></div>
        <div class="text-center" style="margin-top:18px;">
          <span class="auth-link" style="color:var(--text-muted); font-weight:600;" data-action="noop">Sign in as administrator instead</span>
        </div>
      </div>
      <div class="helper-note" style="margin-top:4px;">Existing flow: same phone + password sign-in as today, restyled with the app's own design tokens. No functional change.</div>
      `;
    }
  },

  'auth-register': {
    tab: 'start', back: true, immersive: true,
    render() {
      const role = REGISTER_ROLES.find(r => r.value === State.regRole) || REGISTER_ROLES[0];
      const needsLocation = !!role.locationLabel;
      return `
      ${topBar('Create Account', { back: true })}
      <div class="auth-form-wrap">
        <p class="muted" style="font-size:12.5px; margin:-4px 0 16px;">Verify your mobile number, then wait for distributor approval.</p>
        ${formGroup('Full Name', `<input class="input" placeholder="Juan dela Cruz" />`)}
        ${formGroup('Mobile Number', `<input class="input" type="tel" placeholder="9171234567" />`, 'Philippine mobile number, e.g. 09171234567.')}
        ${formGroup('Password', `<input class="input" type="password" placeholder="At least 8 characters" />`)}
        ${formGroup(`Confirm Password ${proposedTag('Proposed field')}`, `<input class="input" type="password" placeholder="Re-enter password" />`, 'Not present in the current Register screen — added here to prevent typo lockouts.')}
        ${formGroup('Role', `<div class="chip-row">${REGISTER_ROLES.map(r => `<div class="chip ${r.value === State.regRole ? 'active' : ''}" data-action="selectRegRole" data-value="${r.value}">${r.label}</div>`).join('')}</div>`)}
        ${needsLocation ? formGroup(role.locationLabel, `<div class="field-static"><span class="muted">Tap to set on map</span><button class="btn btn-outline btn-sm" data-action="noop">${ICON('pin', 13)} Pin Map</button></div>`) : ''}
        <div class="helper-note" style="margin-top:0;">Distributor accounts are provisioned directly by VeggieTrack — matches current behavior (only Farmer, Retailer, and Rider can self-register).</div>
        <button class="btn btn-primary btn-block" data-action="demoRegister">Register</button>
        <div class="auth-footer-link">Already have an account?<span class="auth-link" data-nav="auth-login">Sign in</span></div>
      </div>
      `;
    }
  },

  'auth-otp': {
    tab: 'start', back: true, immersive: true,
    render() {
      return `
      ${topBar('Verify Your Number', { back: true })}
      <div class="auth-form-wrap text-center">
        <p class="muted" style="font-size:13px;">Enter the 6-digit code sent to<br/><b style="color:var(--text);">+63 917 123 4567</b></p>
        <div class="otp-row">${[1, 2, 3, 4, 5, 6].map(() => `<div class="otp-box">•</div>`).join('')}</div>
        <p class="muted" style="font-size:12px; margin-bottom:20px;">Resend code in 00:45</p>
        <button class="btn btn-primary btn-block" data-action="demoVerifyOtp">Verify</button>
      </div>
      `;
    }
  },

  'auth-pending': {
    tab: 'start', back: false, immersive: true,
    render() {
      return `
      ${topBar('', { back: false })}
      <div class="auth-form-wrap text-center">
        <div class="pending-icon">${ICON('clock', 34)}</div>
        <h2 style="margin:0 0 8px;">Application Under Review</h2>
        <p class="muted" style="font-size:13px; line-height:1.6; max-width:270px; margin:0 auto 24px;">A distributor will review and approve your account shortly. You'll be notified once approved.</p>
        <button class="btn btn-outline btn-block" data-action="logout">Log Out</button>
      </div>
      `;
    }
  },
};
