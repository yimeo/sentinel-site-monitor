export const localAdminUsernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export function formatAdminUsernameRequest(oldUsername: string, newUsername: string): string {
  if (!localAdminUsernamePattern.test(oldUsername) || !localAdminUsernamePattern.test(newUsername)) {
    throw new Error("管理员用户名格式无效。");
  }
  if (oldUsername === newUsername) throw new Error("新的管理员用户名必须与当前用户名不同。");
  return `oldUsername=${oldUsername}\nnewUsername=${newUsername}\n`;
}
