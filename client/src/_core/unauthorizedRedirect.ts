export function shouldStartOAuthRedirect(pathname: string, isUnauthorized: boolean) {
  if (!isUnauthorized) return false;
  return pathname !== "/login" && pathname !== "/setup";
}
