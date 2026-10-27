export const loaders: Record<string, () => Promise<{ default: () => React.ReactNode }>> = {
  alpha: () => import("./modules/alpha/index"),
  beta: () => import("./modules/beta/index"),
  gamma: () => import("./modules/gamma/index"),
};
