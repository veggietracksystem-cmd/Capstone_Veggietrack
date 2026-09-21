// One place that answers "what is the signed-in user?".
//
// The role always comes from the authenticated profile the backend returns
// from /api/auth/me (`vt_account_context`), which is what AuthContext stores
// as `user`. Screens must ask these helpers instead of comparing role strings
// by hand, so a screen can never assume a role the signed-in user does not
// actually have - that mismatch is what made the shared Edit Profile screen
// tell a signed-in distributor to "contact the distributor".

export const ROLES = {
  farmer: 'farmer',
  distributor: 'distributor',
  retailer: 'retailer',
  delivery: 'delivery_personnel',
};

export const roleOf = (user) => user?.role || null;

export const isDistributor = (user) => roleOf(user) === ROLES.distributor;
export const isFarmer = (user) => roleOf(user) === ROLES.farmer;
export const isRetailer = (user) => roleOf(user) === ROLES.retailer;
export const isDeliveryPersonnel = (user) => roleOf(user) === ROLES.delivery;

// Human-readable role name for badges and lists ("Delivery Rider", "Farmer").
const ROLE_LABELS = {
  farmer: 'Farmer',
  distributor: 'Distributor',
  retailer: 'Retailer',
  delivery_personnel: 'Delivery Rider',
};

export const roleLabel = (role) => ROLE_LABELS[role] || (role ? String(role).replace(/_/g, ' ') : '');
