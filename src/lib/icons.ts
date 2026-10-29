// Pixel icons from Pixelarticons by Gerrit Halfmann (https://github.com/halfmage/pixelarticons),
// under the MIT License in public/licenses/pixelarticons-MIT.txt. Each is drawn on a 24 × 24 grid. The pointer
// is theirs redrawn smaller, as tall as the keyboard, so the three ways to play look the same size.
export const ICONS = {
  'aspect-ratio': ["M4 4h16v2H4zM2 6h2v12H2zm2 12h16v2H4zM20 6h2v12h-2zM6 8h4v2H6zm8 6h4v2h-4zm-8-4h2v2H6zm10 2h2v2h-2z"],
  'zap': ["M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"],
  'speed-fast': ["M5 19H3v-2h2v2Zm16 0h-2v-2h2v2ZM3 17H1v-6h2v6Zm11 0h-4v-4h4v4Zm9 0h-2v-6h2v6Zm-7-4h-2v-2h2v2ZM5 11H3V9h2v2Zm13 0h-2V9h2v2ZM9 9H5V7h4v2Zm11 0h-2V7h2v2Zm-5-2H9V5h6v2Z"],
  'sparkles': ["M11 1h2v4h-2zm0 22h2v-4h-2zM9 5h2v4H9zm0 14h2v-4H9zm4-14h2v4h-2zm0 14h2v-4h-2zM5 9h4v2H5zm14 0h-4v2h4zM1 11h4v2H1zm22 0h-4v2h4zM5 13h4v2H5zm14 0h-4v2h4zm0-12h2v6h-2z", "M17 3h6v2h-6zM3 17h2v2H3zm-2 2h2v2H1zm2 2h2v2H3zm2-2h2v2H5z"],
  'star': ["M5 20H8V22H3V16H5V20ZM21 22H16V20H19V16H21V22ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM14 18H10V16H14V18ZM7 16H5V13H7V16ZM19 16H17V13H19V16ZM5 13H3V11H5V13ZM21 13H19V11H21V13ZM9 9H3V11H1V7H9V9ZM23 11H21V9H15V7H23V11ZM11 7H9V3H11V7ZM15 7H13V3H15V7ZM13 3H11V1H13V3Z"],
  'wind': ["M2 7h10v2H2zm10-4h2v4h-2zM7 1h5v2H7zM2 11h18v2H2zm18-4h2v4h-2zm-4-2h4v2h-4zM2 17h12v-2H2zm12 2h2v-2h-2zm-5 2h5v-2H9z"],
  'sword': ["M11 2h2v2h-2zM9 4h2v12H9zm4 0h2v12h-2zM7 16h10v2H7zm4 2h2v4h-2z"],
  'castle': ["M1 8h2v12H1zm2 12h18v2H3zM21 8h2v12h-2zM3 10h18v2H3zm2-8h2v8H5zm12 0h2v8h-2zM7 4h10v2H7zm2-2h2v2H9zm4 0h2v2h-2zM8 16h2v4H8zm2-2h4v2h-4zm4 2h2v4h-2z"],
  'keyboard': ["M21 21H3v-2h18v2ZM3 19H1V5h2v14Zm20 0h-2V5h2v14Zm-5-2H6v-2h12v2Zm-9-4H7v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2ZM7 9H5V7h2v2Zm4 0H9V7h2v2Zm4 0h-2V7h2v2Zm4 0h-2V7h2v2Zm2-4H3V3h18v2Z"],
  'gamepad': ["M4 4h16v2H4zm0 14h16v2H4zM2 6h2v12H2zm18 0h2v12h-2zM8 9h2v6H8z", "M6 11h6v2H6zm8-2h2v2h-2zm2 4h2v2h-2z"],
  'pointer': ["M9 3h2v2h-2zM7 5h2v2h-2zM11 5h2v2h-2zM7 7h2v2h-2zM11 7h4v2h-4zM7 9h2v2h-2zM11 9h2v2h-2zM15 9h4v2h-4zM5 11h4v2h-4zM15 11h2v2h-2zM19 11h2v2h-2zM3 13h2v2h-2zM7 13h2v2h-2zM19 13h2v2h-2zM3 15h2v2h-2zM9 15h2v2h-2zM19 15h2v2h-2zM5 17h2v2h-2zM17 17h2v2h-2zM7 19h10v2h-10z"],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as [IconName, ...IconName[]];
