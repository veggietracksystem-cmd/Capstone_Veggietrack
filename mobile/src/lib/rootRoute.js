// Decides which root stack branch renders and its initial screen. Both come from
// one place because React Navigation reads initialRouteName only when the
// navigator mounts and throws if the route is not in the rendered branch.

export const ROOT_BRANCH_ENTRY = {
  recovery: 'ResetPassword',
  status: 'ApplicationStatus',
};

export function rootBranch({ recoveryMode, session, roleScreen }) {
  if (recoveryMode) return 'recovery';
  if (session && !roleScreen) return 'status';
  if (roleScreen) return 'role';
  return 'auth';
}

// `initialRoute` is the unauthenticated entry point ('Landing' or 'Login') and
// is only honoured by the branch that actually renders those screens.
export function rootInitialRoute({ recoveryMode, session, roleScreen, initialRoute }) {
  const branch = rootBranch({ recoveryMode, session, roleScreen });
  if (branch === 'role') return roleScreen.name;
  return ROOT_BRANCH_ENTRY[branch] || initialRoute;
}
