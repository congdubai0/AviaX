export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        mockInitData?: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: {
            id: number;
            first_name: string;
            username?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        openLink?: (url: string) => void;
        HapticFeedback?: {
          impactOccurred: (style: "light" | "medium" | "heavy") => void;
        };
      };
    };
  }
}
