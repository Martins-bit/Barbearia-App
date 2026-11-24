interface VerticalBounds {
  top: number
  bottom: number
}

const MESSAGE_MENU_HEIGHT = 104

export function shouldOpenMessageMenuAbove(
  trigger: VerticalBounds,
  scrollport: VerticalBounds,
): boolean {
  const spaceAbove = trigger.top - scrollport.top
  const spaceBelow = scrollport.bottom - trigger.bottom

  if (spaceBelow >= MESSAGE_MENU_HEIGHT) return false
  return spaceAbove >= MESSAGE_MENU_HEIGHT || spaceAbove > spaceBelow
}
