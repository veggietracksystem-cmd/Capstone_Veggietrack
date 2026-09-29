import { tr } from '../i18n/translate';
// Role helpers. The role always comes from the authenticated profile
// (/api/auth/me); screens use these helpers instead of comparing role strings.

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
const ROLE_LABEL_KEYS = {
  farmer: 'misc.roleFarmer',
  distributor: 'misc.roleDistributor',
  retailer: 'misc.roleRetailer',
  delivery_personnel: 'misc.roleRider',
};

export const roleLabel = (role) => (ROLE_LABEL_KEYS[role] ? tr(ROLE_LABEL_KEYS[role]) : (role ? String(role).replace(/_/g, ' ') : ''));
