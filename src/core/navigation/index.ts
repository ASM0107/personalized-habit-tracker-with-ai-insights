export type AppScreen =
  | { readonly name: "DASHBOARD" }
  | { readonly name: "HABIT_DETAIL"; readonly habitId: string }
  | { readonly name: "NEW_HABIT" }
  | { readonly name: "INSIGHTS" }
  | { readonly name: "ANALYTICS" };

export type NavigationListener = (screen: AppScreen) => void;

export interface NavigationPort {
  getCurrentScreen(): AppScreen;
  navigate(screen: AppScreen): void;
  goBack(): boolean;
  subscribe(listener: NavigationListener): () => void;
}

export class StackNavigationRouter implements NavigationPort {
  private readonly history: AppScreen[] = [{ name: "DASHBOARD" }];
  private readonly listeners = new Set<NavigationListener>();

  public getCurrentScreen(): AppScreen {
    const current = this.history[this.history.length - 1];
    return current ?? { name: "DASHBOARD" };
  }

  public navigate(screen: AppScreen): void {
    this.history.push(screen);
    this.notify(screen);
  }

  public goBack(): boolean {
    if (this.history.length <= 1) {
      return false;
    }
    this.history.pop();
    const current = this.getCurrentScreen();
    this.notify(current);
    return true;
  }

  public subscribe(listener: NavigationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(screen: AppScreen): void {
    for (const listener of this.listeners) {
      listener(screen);
    }
  }
}
