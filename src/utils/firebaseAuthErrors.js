// Maps Firebase Auth error codes to user-facing copy, shared by Login and
// Registration so both surface consistent, friendly messages instead of
// raw Firebase error strings.
const MESSAGES = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with that email already exists.',
  'auth/weak-password': 'That password does not meet the minimum security requirements.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/network-request-failed': 'Network error — check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
};

export function getFirebaseAuthErrorMessage(error) {
  return MESSAGES[error?.code] || 'Something went wrong. Please try again.';
}
