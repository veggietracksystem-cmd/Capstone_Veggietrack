// Which branch of the root stack renders, and which screen it starts on.
//
// React Navigation resolves initialRouteName once, when the Navigator mounts,
// and throws if that name is not among the screens the branch renders. App.js
// unmounts the Navigator while a profile is still loading, so the two answers
// have to come from one place instead of being written out twice.

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
