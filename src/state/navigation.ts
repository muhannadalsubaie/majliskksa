export type ScreenName =
  | 'splash' | 'auth' | 'menu' | 'createTable' | 'joinTable' | 'table' | 'friends' | 'settings';

export type Navigate = (screen: ScreenName) => void;
