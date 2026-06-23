/**
 * Keyboard utility functions for handling IME (Input Method Editor) events
 * Prevents issues with Chinese/Japanese/Korean input methods on macOS
 */

/**
 * Check if Enter key was pressed without IME composition
 * 
 * On macOS with Chinese IME (Zhuyin/Pinyin), pressing Enter to confirm
 * character selection also triggers the keydown event. This function
 * filters out those cases to prevent premature form submission.
 * 
 * @param e - KeyboardEvent from React or native DOM
 * @returns true if Enter was pressed AND IME is not composing
 */
export function isEnterWithoutIME(
  e: React.KeyboardEvent | KeyboardEvent
): boolean {
  if (e.key !== 'Enter') return false;
  
  // Check native event for isComposing (React wraps the event)
  const nativeEvent = 'nativeEvent' in e ? e.nativeEvent : e;
  
  // isComposing: true when IME is in composition state
  if (nativeEvent.isComposing) return false;
  
  // keyCode 229: IME is processing input (legacy fallback for older browsers)
  if (e.keyCode === 229) return false;
  
  return true;
}

/**
 * Check if Enter key was pressed with Shift modifier (for newline in textarea)
 * Also respects IME composition state
 * 
 * @param e - KeyboardEvent from React or native DOM
 * @returns true if Shift+Enter was pressed AND IME is not composing
 */
export function isShiftEnterWithoutIME(
  e: React.KeyboardEvent | KeyboardEvent
): boolean {
  if (e.key !== 'Enter' || !e.shiftKey) return false;
  
  const nativeEvent = 'nativeEvent' in e ? e.nativeEvent : e;
  if (nativeEvent.isComposing) return false;
  if (e.keyCode === 229) return false;
  
  return true;
}
