export type ScreenName =
  | 'splash' | 'auth' | 'menu' | 'createTable' | 'joinTable' | 'table' | 'friends' | 'settings' | 'shop';

export type Navigate = (screen: ScreenName) => void;
