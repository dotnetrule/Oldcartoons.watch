/**
 * Putting one element of the page on the whole screen.
 *
 * Two views need this and neither can rely on the standard alone. Safari below
 * 16.4 ships only the `webkit` names and older Edge only the `ms` ones —
 * neither is optional, because those are the browsers most likely to be
 * pointed at a television. iOS Safari exposes no element fullscreen at all, so
 * there is a second mode: filling the viewport with CSS. It is not the real
 * thing, but it beats a button that does nothing.
 *
 * The caller gets one flag for "are we full screen" and one class hook for the
 * CSS mode, and never has to know which of the two is in play.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
};

const fsDoc = document as FullscreenDocument;

function fullscreenElement(): Element | null {
  return fsDoc.fullscreenElement ?? fsDoc.webkitFullscreenElement ?? fsDoc.msFullscreenElement ?? null;
}

async function exitNativeFullscreen(): Promise<void> {
  const exit = fsDoc.exitFullscreen ?? fsDoc.webkitExitFullscreen ?? fsDoc.msExitFullscreen;
  try {
    await exit?.call(fsDoc);
  } catch {
    /* Leaving fullscreen can only fail when we already left it. */
  }
}

export function useFullscreen(target: Ref<HTMLElement | null>): {
  /** True in either mode — what a button label should read from. */
  isFullscreen: Ref<boolean>;
  /** True only in the CSS fallback, for the class that fills the viewport. */
  cssFullscreen: Ref<boolean>;
  toggle: () => Promise<void>;
} {
  const nativeFullscreen = ref(false);
  const cssFullscreen = ref(false);
  const isFullscreen = computed(() => nativeFullscreen.value || cssFullscreen.value);

  function syncFullscreenState(): void {
    nativeFullscreen.value = fullscreenElement() !== null;
    // Escape, the browser chrome and the F11 key all land here, so this is also
    // what keeps the button's label honest.
    if (nativeFullscreen.value) cssFullscreen.value = false;
  }

  async function enterNativeFullscreen(): Promise<boolean> {
    const element = target.value as FullscreenElement | null;
    const request =
      element?.requestFullscreen ?? element?.webkitRequestFullscreen ?? element?.msRequestFullscreen;
    if (!element || !request) return false;
    try {
      await request.call(element);
      return true;
    } catch {
      return false;
    }
  }

  async function toggle(): Promise<void> {
    if (fullscreenElement()) {
      await exitNativeFullscreen();
      return;
    }
    if (cssFullscreen.value) {
      cssFullscreen.value = false;
      return;
    }
    cssFullscreen.value = !(await enterNativeFullscreen());
  }

  function onKeydown(event: KeyboardEvent): void {
    // The CSS mode has no browser affordance to leave it, so it has to honour
    // the key every viewer already reaches for.
    if (event.key === 'Escape' && cssFullscreen.value) cssFullscreen.value = false;
  }

  watch(cssFullscreen, (on) => {
    // The element is taken out of the page flow, so the page behind it must not
    // keep its own scrollbar.
    document.body.style.overflow = on ? 'hidden' : '';
  });

  onMounted(() => {
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    document.addEventListener('MSFullscreenChange', syncFullscreenState);
    window.addEventListener('keydown', onKeydown);
    syncFullscreenState();
  });

  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', syncFullscreenState);
    document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    document.removeEventListener('MSFullscreenChange', syncFullscreenState);
    window.removeEventListener('keydown', onKeydown);
    document.body.style.overflow = '';
    if (fullscreenElement()) void exitNativeFullscreen();
  });

  return { isFullscreen, cssFullscreen, toggle };
}
