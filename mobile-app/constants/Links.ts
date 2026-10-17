// Replace both addresses with your real hosted pages before building for the Play Store.
export const PRIVACY_POLICY_URL = 'https://REPLACE_ME/privacy-policy.html';
export const DELETE_ACCOUNT_URL = 'https://REPLACE_ME/delete-account.html';

export function isPlaceholderUrl(url: string) {
  return url.includes('REPLACE_ME');
}  