export function completeLocalAuth<TUser>(
  user: TUser,
  actions: {
    setCurrentUser: (user: TUser) => void;
    notifySuccess: () => void;
    navigateHome: () => void;
  }
) {
  actions.setCurrentUser(user);
  actions.notifySuccess();
  actions.navigateHome();
}
